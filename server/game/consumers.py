import asyncio
import json
import logging
import time
import redis
import redis.asyncio as aioredis
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from django.conf import settings
from thespian.actors import ActorSystem
from game.matchmaking import Matchmaker
import json

logger = logging.getLogger(__name__)


logger = logging.getLogger(__name__)

# global sync redis for matchmaking
try:
    REDIS_URL = getattr(settings, 'REDIS_URL', f"redis://{getattr(settings, 'REDIS_HOST', 'localhost')}:{getattr(settings, 'REDIS_PORT', 6379)}/0")
    redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
except Exception as e:
    logger.warning(f"Global Redis client failed to initialize: {e}")
    redis_client = None


class GameConsumer(AsyncWebsocketConsumer):
    """
    Pure I/O Router.
    Routes incoming WS messages (Moves, Draws, Resignations, Takebacks) to the GameActor.
    Listens to Redis PubSub to broadcast state updates back to clients.
    """
    
    async def connect(self):
        self.game_id = self.scope['url_route']['kwargs']['game_id']
        self.room_group_name = f'game_{self.game_id}'
        self.user = self.scope['user']
        
        if not self.user.is_authenticated:
            await self.close()
            return

        # Connect to the singleton Actor System (multiprocTCPBase prevents duplication)
        self.actor_system = ActorSystem("multiprocTCPBase")
        
        # Redis pub/sub channels
        self.game_channel = f"game:{self.game_id}:events"
        self.clock_channel = f"game:{self.game_id}:clock"
        
        try:
            redis_url = getattr(settings, 'REDIS_URL', f"redis://{getattr(settings, 'REDIS_HOST', 'localhost')}:{getattr(settings, 'REDIS_PORT', 6379)}/0")
            self.redis = await aioredis.from_url(
                redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_keepalive=True,
                socket_keepalive_options={1: 1, 2: 1, 3: 3},
            )
            
            self.pubsub = self.redis.pubsub()
            await self.pubsub.subscribe(self.game_channel, self.clock_channel)
            self.listener_task = asyncio.create_task(self._redis_listener())
            logger.info(f"Redis connected for game {self.game_id}")
        except Exception as e:
            logger.error(f"❌ Redis connection failed: {e}. Falling back to channel layer only.")
            self.redis = None
            self.pubsub = None
        
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()
        
        # Tell the actor the user has joined (Actor handles initial state)
        await self._send_to_actor({'type': 'join_game'})
        logger.info(f"{self.user.username} connected to game {self.game_id}")
    
    async def disconnect(self, close_code):
        if hasattr(self, 'pubsub') and self.pubsub:
            await self.pubsub.unsubscribe(self.game_channel, self.clock_channel)
            await self.pubsub.close()
            
        if hasattr(self, 'listener_task'):
            self.listener_task.cancel()
            
        if hasattr(self, 'redis') and self.redis:
            await self.redis.close()
            
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        
        # Notify actor of disconnect
        await self._send_to_actor({'type': 'leave_game'})
    
    async def receive(self, text_data):
        """Handle ALL incoming WebSocket messages and route to specific functions"""
        try:
            data = json.loads(text_data)
            msg_type = data.get('type')
            payload = data.get('payload', {})
            
            # Explicit routing for every single chess feature you built
            if msg_type == 'join_game':
                await self.join_game(payload)
            elif msg_type == 'move':
                await self.make_move(payload)
            elif msg_type == 'chat':
                await self.handle_chat(payload)
            elif msg_type == 'jump_to_move':
                await self.jump_to_move(payload)
            elif msg_type == 'resign':
                await self.resign(payload)
            elif msg_type == 'offer_draw':
                await self.offer_draw(payload)
            elif msg_type == 'accept_draw':
                await self.accept_draw(payload)
            elif msg_type == 'decline_draw':
                await self.decline_draw(payload)
            elif msg_type == 'request_takeback':
                await self.request_takeback(payload)
            elif msg_type == 'accept_takeback':
                await self.accept_takeback(payload)
            else:
                # Catch-all for anything else
                self._send_to_actor({'type': msg_type, 'payload': payload})
                
        except json.JSONDecodeError:
            await self.send_error('Invalid JSON format')

    # action routers

    async def join_game(self, payload):
        await self._send_to_actor({'type': 'join_game', 'payload': payload})

    async def make_move(self, payload):
        # The actor will handle the Engine check, Redis lock, and timestamp clock math
        await self._send_to_actor({'type': 'move', 'payload': payload})

    async def handle_chat(self, payload):
        await self._send_to_actor({'type': 'chat', 'payload': payload})

    async def jump_to_move(self, payload):
        await self._send_to_actor({'type': 'jump_to_move', 'payload': payload})

    async def resign(self, payload):
        # The actor will update the DB and broadcast the game_ended event
        await self._send_to_actor({'type': 'resign', 'payload': payload})

    async def offer_draw(self, payload):
        await self._send_to_actor({'type': 'offer_draw', 'payload': payload})

    async def accept_draw(self, payload):
        await self._send_to_actor({'type': 'accept_draw', 'payload': payload})

    async def decline_draw(self, payload):
        await self._send_to_actor({'type': 'decline_draw', 'payload': payload})

    async def request_takeback(self, payload):
        await self._send_to_actor({'type': 'request_takeback', 'payload': payload})

    async def accept_takeback(self, payload):
        # The actor will pop the last move from state, revert FEN, and trigger PostgresWriterActor
        await self._send_to_actor({'type': 'accept_takeback', 'payload': payload})

    # helpers

    async def _send_to_actor(self, message_data):
        """
        Wraps every action with user context and routes it to the correct Actor.
        Uses globalName so all workers hit the exact same memory space.
        """

        # Standardized wrapper for the Actor
        wrapped_message = {
            'game_id': self.game_id,
            'user_id': self.user.id,
            'username': self.user.username,
            'timestamp': time.time(),
            'data': message_data
        }
        # Isolate the synchronous actor calls in a local function
        def sync_dispatch():
            from game.actors.game_actor import GameActor 
            actor_address = self.actor_system.createActor(
                GameActor, 
                globalName=f"game:{self.game_id}"
            )
            self.actor_system.tell(actor_address, wrapped_message)

        # Execute safely without blocking the WebSocket loop
        await asyncio.to_thread(sync_dispatch)

    async def _redis_listener(self):
        """Listen for state updates from the GameActor and blast to the WS"""
        try:
            async for message in self.pubsub.listen():
                if message['type'] == 'message':
                    await self.send(text_data=message['data'])
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Redis listener error: {e}")
            
    async def send_error(self, message):
        await self.send(json.dumps({'type': 'error', 'message': message}))

    async def broadcast_move(self, event):
        """Fallback channel layer broadcast receiver"""
        if event.get('event'):
            await self.send(json.dumps(event['event']))

class MatchmakingConsumer(AsyncWebsocketConsumer):
    """
    Handles user matchmaking via Redis Lua script.
    Maintains Ghost Player cleanup.
    """
    
    async def connect(self):
        self.user = self.scope['user']
        if not self.user.is_authenticated:
            await self.close()
            return
            
        self.user_group = f"user_{self.user.id}"
        await self.channel_layer.group_add(self.user_group, self.channel_name)
        await self.accept()

        # We keep the async redis for lightweight operations like queue status
        self.redis = await aioredis.from_url(
            getattr(settings, 'REDIS_URL', 'redis://localhost:6379/0'), 
            decode_responses=True
        )
        
        # Initialize our Lua-backed matchmaker 
        self.matchmaker = Matchmaker()

    async def disconnect(self, close_code):
        # Ghost Player cleanup - instantly rip user from the sorted sets
        if hasattr(self, 'current_time_control'):
            queue_key = f"matchmaking:{self.current_time_control}"
            # ZREM is used instead of SREM because we are using Sorted Sets now
            await self.redis.zrem(queue_key, self.user.id)
            await self.redis.hdel(f"{queue_key}:times", self.user.id)
                
        if hasattr(self, 'redis'):
            await self.redis.close()
            
        await self.channel_layer.group_discard(self.user_group, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            action = data.get('action')
            time_control = data.get('time_control', '10+0')
            
            if action == 'join_queue':
                self.current_time_control = time_control
                
                # Notify frontend we are searching
                await self.send(json.dumps({
                    'type': 'matchmaking.queued',
                    'time_control': time_control,
                    'message': 'Searching for opponent...'
                }))
                
                # Execute the synchronous Matchmaker in a background thread 
                # so it doesn't block the async WebSocket loop
                await asyncio.to_thread(
                    self.matchmaker.process_queue, 
                    str(self.user.id), 
                    self.user.rating, 
                    time_control
                )
                
            elif action == 'leave_queue':
                queue_key = f"matchmaking:{time_control}"
                await self.redis.zrem(queue_key, self.user.id)
                await self.redis.hdel(f"{queue_key}:times", self.user.id)
                
                await self.send(json.dumps({'type': 'matchmaking.left'}))
                
            elif action == 'get_queue_status':
                # ZCARD gets the count of a Sorted Set (used instead of SCARD)
                count = await self.redis.zcard(f"matchmaking:{time_control}")
                await self.send(json.dumps({
                    'type': 'queue_status',
                    'time_control': time_control,
                    'players_in_queue': count
                }))
                
        except json.JSONDecodeError:
            await self.send(json.dumps({'type': 'error', 'message': 'Invalid JSON'}))

    # Channel Layer Handlers
    # These are triggered by the Matchmaker._create_and_notify() method

    async def match_found(self, event):
        await self.send(json.dumps({
            'type': 'match_found',
            'game_id': event['game_id'],
            'color': event['color'],
            'message': 'Match found! Starting game...'
        }))
        
    async def matchmaking_timeout(self, event):
        await self.send(json.dumps({
            'type': 'timeout', 
            'message': event.get('message', 'Timeout')
        }))



class UserNotificationConsumer(AsyncWebsocketConsumer):
    """Per-user WebSocket for notifications (challenges, friend requests, etc.)"""

    async def connect(self):
        await self.accept()
        
        self.user = self.scope['user']
        
        if not self.user.is_authenticated:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Authentication required - Please pass ?token=YOUR_JWT in WebSocket URL'
            }))
            await self.close()
            return
        
        self.user_group = f"user_{self.user.id}"
        
        await self.channel_layer.group_add(
            self.user_group,
            self.channel_name
        )
        
        # Send connection success
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'user_id': self.user.id,
            'message': 'Successfully connected to notifications'
        }))
    
    async def disconnect(self, close_code):
        if hasattr(self, 'user_group'):
            await self.channel_layer.group_discard(
                self.user_group,
                self.channel_name
            )
    
    async def user_notification(self, event):
        """Handle notification events from Redis/channel layer"""
        await self.send(text_data=json.dumps(event['message']))


class SpectatorConsumer(AsyncWebsocketConsumer):
    """
    Read-only stream for spectators. 
    Only listens to Redis PubSub, preventing unauthorized move injections.
    """
    async def connect(self):
        self.game_id = self.scope['url_route']['kwargs']['game_id']
        self.room_group_name = f'spectate_{self.game_id}'
        
        # Redis pub/sub channels
        self.game_channel = f"game:{self.game_id}:events"
        self.clock_channel = f"game:{self.game_id}:clock"
        
        redis_url = getattr(settings, 'REDIS_URL', 'redis://localhost:6379/0')
        self.redis = await aioredis.from_url(redis_url, decode_responses=True)
        self.pubsub = self.redis.pubsub()
        
        await self.pubsub.subscribe(self.game_channel, self.clock_channel)
        self.listener_task = asyncio.create_task(self._redis_listener())
        
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'pubsub') and self.pubsub:
            await self.pubsub.unsubscribe(self.game_channel, self.clock_channel)
            await self.pubsub.close()
        if hasattr(self, 'listener_task'):
            self.listener_task.cancel()
        if hasattr(self, 'redis'):
            await self.redis.close()

    async def receive(self, text_data):
        # Explicitly ignore any incoming messages from spectators
        pass 

    async def _redis_listener(self):
        try:
            async for message in self.pubsub.listen():
                if message['type'] == 'message':
                    await self.send(text_data=message['data'])
        except asyncio.CancelledError:
            pass