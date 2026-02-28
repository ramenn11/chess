import asyncio
import json
import redis
import redis.asyncio as aioredis
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from django.utils import timezone
from datetime import datetime
from django.conf import settings
from .tasks import find_match, leave_queue

# --- Global Synchronous Redis for Matchmaking ---
# Used for atomic operations in MatchmakingConsumer to avoid Celery bottlenecks
# Tries to load REDIS_URL, falls back to localhost if not set
try:
    REDIS_URL = getattr(settings, 'REDIS_URL', f"redis://{getattr(settings, 'REDIS_HOST', 'localhost')}:{getattr(settings, 'REDIS_PORT', 6379)}/0")
    redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
except Exception as e:
    print(f"Warning: Global Redis client failed to initialize: {e}")
    redis_client = None

class GameConsumer(AsyncWebsocketConsumer):
    """Event-driven game consumer using Redis pub/sub"""
    
    async def connect(self):
        self.game_id = self.scope['url_route']['kwargs']['game_id']
        self.room_group_name = f'game_{self.game_id}'
        self.user = self.scope['user']
        
        # Redis pub/sub channels
        self.game_channel = f"game:{self.game_id}:events"
        self.clock_channel = f"game:{self.game_id}:clock"
        
        # FIX: Better Redis connection supporting REDIS_URL and KeepAlive options
        try:
            # Determine connection URL
            if hasattr(settings, 'REDIS_URL'):
                redis_url = settings.REDIS_URL
            else:
                host = getattr(settings, 'REDIS_HOST', 'localhost')
                port = getattr(settings, 'REDIS_PORT', 6379)
                redis_url = f"redis://{host}:{port}"

            self.redis = await aioredis.from_url(
                redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_keepalive=True,  # Keep connection alive
                socket_keepalive_options={
                    1: 1,  # TCP_KEEPIDLE
                    2: 1,  # TCP_KEEPINTVL
                    3: 3,  # TCP_KEEPCNT
                },
            )
            
            # Subscribe to game events
            self.pubsub = self.redis.pubsub()
            await self.pubsub.subscribe(self.game_channel, self.clock_channel)
            
            # Start listening task
            self.listener_task = asyncio.create_task(self._redis_listener())
            
            print(f"Redis connected for game {self.game_id}")
        except Exception as e:
            print(f"❌ Redis connection failed: {e}. Falling back to channel layer only.")
            self.redis = None
            self.pubsub = None
        
        # Join channel layer group for broadcasts (fallback)
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        # Subscribe to clock manager
        if self.redis:
            self.clock_manager = GameClockManager.get_or_create(self.game_id, self.redis)
            await self.clock_manager.subscribe(self.channel_name)
        
        await self.accept()
        print(f"{self.user.username} connected to game {self.game_id}")
    
    async def disconnect(self, close_code):
        print(f"{self.user.username} disconnecting from game {self.game_id} (code: {close_code})")
        
        # Unsubscribe from Redis
        if hasattr(self, 'pubsub') and self.pubsub:
            try:
                await self.pubsub.unsubscribe(self.game_channel, self.clock_channel)
                await self.pubsub.close()
            except Exception as e:
                print(f"Error unsubscribing from Redis: {e}")
        
        # Cancel listener
        if hasattr(self, 'listener_task') and self.listener_task:
            self.listener_task.cancel()
            try:
                await self.listener_task
            except asyncio.CancelledError:
                pass
        
        # Unsubscribe from clock
        if hasattr(self, 'clock_manager') and self.clock_manager:
            await self.clock_manager.unsubscribe(self.channel_name)
        
        # Leave channel layer group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        
        # Close Redis connection
        if hasattr(self, 'redis') and self.redis:
            try:
                await self.redis.close()
            except Exception as e:
                print(f"Error closing Redis: {e}")
        
        print(f"{self.user.username} disconnected from game {self.game_id}")
    
    async def _redis_listener(self):
        """Listen for Redis pub/sub messages"""
        try:
            async for message in self.pubsub.listen():
                if message['type'] == 'message':
                    try:
                        data = json.loads(message['data'])
                        await self._handle_redis_event(data)
                    except json.JSONDecodeError as e:
                        print(f"Failed to parse Redis message: {message['data']} - {e}")
                    except Exception as e:
                        print(f"Error handling Redis event: {e}")
                        import traceback
                        traceback.print_exc()
        except asyncio.CancelledError:
            print("🔌 Redis listener cancelled")
        except Exception as e:
            print(f"Redis listener error: {e}")
    
    async def _handle_redis_event(self, event):
        """Handle incoming Redis events - Pass directly to websocket"""
        # Logic from original file preserved (handling specific types if needed)
        # But mostly we just forward the event payload
        await self.send(json.dumps(event))
    
    async def receive(self, text_data):
        """Handle incoming WebSocket messages"""
        try:
            data = json.loads(text_data)
            msg_type = data.get('type')
            payload = data.get('payload', {})
            
            if msg_type == 'join_game':
                await self.join_game()
            elif msg_type == 'move':
                await self.make_move(payload)
            elif msg_type == 'chat':
                await self.handle_chat(payload)
            elif msg_type == 'jump_to_move':
                await self.jump_to_move(payload)
            elif msg_type == 'resign':
                await self.resign()
            elif msg_type == 'offer_draw':
                await self.offer_draw()
            elif msg_type == 'accept_draw':
                await self.accept_draw()
            elif msg_type == 'decline_draw':
                await self.decline_draw()
        except json.JSONDecodeError:
            await self.send(json.dumps({
                'type': 'error',
                'message': 'Invalid JSON'
            }))
    
    async def join_game(self):
        """Initialize game state for new connection"""
        game = await self.get_game()
        if not game:
            await self.send(json.dumps({
                'type': 'error',
                'message': 'Game not found'
            }))
            return
        
        moves = await self.get_moves()
        
        await self.send(json.dumps({
            'type': 'game_state',
            'game_id': game.game_id,
            'white_player': {
                'id': game.white_player.id,
                'username': game.white_player.username,
                'rating': game.white_rating_before
            },
            'black_player': {
                'id': game.black_player.id,
                'username': game.black_player.username,
                'rating': game.black_rating_before
            },
            'fen': game.current_fen,
            'status': game.status,
            'white_time': game.white_time_left,
            'black_time': game.black_time_left,
            'increment': game.increment * 1000,
            'moves': [
                {
                    'from': m.from_square,
                    'to': m.to_square,
                    'notation': m.algebraic_notation,
                    'color': m.color,
                    'piece': m.piece,
                    'captured': m.captured_piece,
                } for m in moves
            ],
            'current_turn': game.current_turn,
        }))
    
    async def make_move(self, payload):
        """
        Handle move from player - Event-driven with Redis
        PRESERVED: High-detail validation from Original File
        """
        from_square = payload.get('from')
        to_square = payload.get('to')
        promotion = payload.get('promotion')
        
        # Add move attempt logging
        print(f"Move attempt: {self.user.username} {from_square}->{to_square}")
        
        # Acquire distributed lock via Redis (FIX: Using nx=True from fixes)
        if self.redis:
            lock_key = f"lock:game:{self.game_id}:move"
            lock_acquired = await self.redis.set(lock_key, self.user.id, nx=True, ex=5)
            
            if not lock_acquired:
                await self.send(json.dumps({
                    'type': 'error',
                    'message': 'Move in progress, please wait'
                }))
                return
        
        try:
            game = await self.get_game()
            
            if not game or game.status != 'ongoing':
                print(f"❌ Invalid game state: status={game.status if game else 'None'}")
                await self.send(json.dumps({
                    'type': 'error',
                    'message': 'Invalid game state'
                }))
                return
            
            # Verify it's player's turn
            if (game.current_turn == 'white' and game.white_player.id != self.user.id) or \
               (game.current_turn == 'black' and game.black_player.id != self.user.id):
                print(f"❌ Not player's turn: current={game.current_turn}, player={self.user.username}")
                await self.send(json.dumps({
                    'type': 'error',
                    'message': 'Not your turn'
                }))
                return
            
            # CRITICAL: Capture color BEFORE engine changes state
            moving_color = game.current_turn
            
            # Validate and execute move
            from .chess_engine import ChessEngine
            engine = ChessEngine(game.current_fen)
            
            # Add detailed validation logging
            print(f"Board state: turn={engine.turn}, FEN={game.current_fen[:50]}...")
            
            if not engine.is_valid_move(from_square, to_square, promotion):
                # Log WHY it's invalid
                piece = engine.board.get(from_square)
                print(f"   Invalid move rejected: {from_square} -> {to_square}")
                
                await self.send(json.dumps({
                    'type': 'error',
                    'message': f'Invalid move: {from_square} to {to_square}'
                }))
                return
            
            # Execute move in engine
            result = engine.make_move(from_square, to_square, promotion)
            
            print(f"Move executed: {moving_color} {from_square}->{to_square} = {result['notation']}")
            
            # Add time increment to player who just moved
            if moving_color == 'white':
                game.white_time_left += game.increment * 1000
            else:
                game.black_time_left += game.increment * 1000
            
            # Save move to database
            move = await self.save_move(game, from_square, to_square, result, moving_color)
            
            # Update game state in database
            await self.update_game_state(
                game.game_id,
                result['fen'],
                result.get('status'),
                game.white_time_left,
                game.black_time_left
            )
            
            # FIX: Publish move event to Redis (with fallback)
            move_event = {
                'type': 'move_made',
                'move': {
                    'from': from_square,
                    'to': to_square,
                    'notation': result['notation'],
                    'piece': result['piece'],
                    'captured': result.get('captured', ''),
                    'fen': result['fen'],
                    'status': result.get('status', 'ongoing'),
                    'winner': result.get('winner'),
                    'is_check': result.get('is_check', False),
                    'is_checkmate': result.get('is_checkmate', False),
                    'color': moving_color,
                    'timestamp': timezone.now().isoformat(),
                    'sequence': game.move_count,
                },
                'fen': result['fen'],  # Add top-level FEN
                'white_time': game.white_time_left,
                'black_time': game.black_time_left,
            }
            
            # Publish to Redis if available
            if self.redis:
                await self.redis.publish(self.game_channel, json.dumps(move_event))
            
            # Also broadcast via channel layer (fallback)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_move',
                    'event': move_event
                }
            )
            
        except Exception as e:
            print(f"Move error: {e}")
            import traceback
            traceback.print_exc()
            await self.send(json.dumps({
                'type': 'error',
                'message': f'Move failed: {str(e)}'
            }))
        finally:
            # Release lock
            if self.redis:
                await self.redis.delete(lock_key)
    
    async def handle_chat(self, payload):
        """Broadcast chat message via Redis"""
        chat_event = {
            'type': 'chat_message',
            'message': {
                'id': payload.get('timestamp', str(timezone.now().timestamp())),
                'user': payload.get('user'),
                'text': payload.get('text'),
                'timestamp': payload.get('timestamp'),
                'is_system': payload.get('is_system', False),
            }
        }
        await self.redis.publish(self.game_channel, json.dumps(chat_event))
    
    async def jump_to_move(self, payload):
        """Send state snapshot at specific move"""
        move_index = payload.get('move_index', -1)
        game = await self.get_game()
        moves = await self.get_moves()
        
        if move_index < 0 or move_index >= len(moves):
            await self.send(json.dumps({
                'type': 'state_snapshot',
                'fen': game.current_fen,
                'white_time': game.white_time_left,
                'black_time': game.black_time_left,
                'move_index': len(moves) - 1,
                'check': None,
                'last_move': None,
            }))
            return
        
        target_move = moves[move_index]
        await self.send(json.dumps({
            'type': 'state_snapshot',
            'fen': target_move.fen_after,
            'white_time': target_move.time_left if target_move.color == 'white' else game.white_time_left,
            'black_time': target_move.time_left if target_move.color == 'black' else game.black_time_left,
            'move_index': move_index,
            'check': target_move.is_check,
            'last_move': {
                'from': target_move.from_square,
                'to': target_move.to_square,
            },
        }))
    
    async def resign(self):
        """Handle resignation via Redis event"""
        game = await self.get_game()
        
        if not game or game.status != 'ongoing':
            return
        
        # Determine winner
        if game.white_player.id == self.user.id:
            winner = game.black_player
            winner_color = 'black'
            result = '0-1'
        elif game.black_player.id == self.user.id:
            winner = game.white_player
            winner_color = 'white'
            result = '1-0'
        else:
            return
        
        # Update game in database
        await self.end_game(
            game.game_id,
            status='completed',
            result=result,
            winner=winner,
            termination='resignation'
        )
        
        # Publish game end event to Redis
        end_event = {
            'type': 'game_ended',
            'status': 'completed',
            'winner': winner_color,
            'termination': 'resignation',
            'result': result,
            'message': f'{self.user.username} resigned'
        }
        await self.redis.publish(self.game_channel, json.dumps(end_event))
    
    async def offer_draw(self):
        """Offer draw via Redis"""
        game = await self.get_game()
        if not game or game.status != 'ongoing': return
        
        # Determine who made the offer
        if game.white_player.id == self.user.id:
            offer_from = 'white'
        elif game.black_player.id == self.user.id:
            offer_from = 'black'
        else:
            return
        
        # Publish draw offer to Redis
        draw_event = {
            'type': 'draw_offer',
            'offer_from': offer_from,
            'username': self.user.username,
        }
        await self.redis.publish(self.game_channel, json.dumps(draw_event))
    
    async def accept_draw(self):
        """Accept draw via Redis"""
        game = await self.get_game()
        if not game or game.status != 'ongoing': return
        
        # Update game to draw
        await self.end_game(
            game.game_id,
            status='completed',
            result='1/2-1/2',
            winner=None,
            termination='agreement'
        )
        
        # Publish game end to Redis
        end_event = {
            'type': 'game_ended',
            'status': 'completed',
            'winner': None,
            'termination': 'agreement',
            'result': '1/2-1/2',
            'message': 'Draw by agreement'
        }
        await self.redis.publish(self.game_channel, json.dumps(end_event))
    
    async def decline_draw(self):
        """Decline draw offer via Redis"""
        decline_event = {
            'type': 'draw_declined',
            'message': 'Draw offer declined'
        }
        await self.redis.publish(self.game_channel, json.dumps(decline_event))
    
    # Channel layer handlers (for clock updates from manager)
    async def clock_tick(self, event):
        """Handle clock tick from clock manager"""
        await self.send(json.dumps({
            'type': 'clock_sync',
            'white_time': event['white_time'],
            'black_time': event['black_time'],
        }))
    
    # Database operations
    @database_sync_to_async
    def get_game(self):
        from .models import Game
        try:
            return Game.objects.select_related('white_player', 'black_player').get(game_id=self.game_id)
        except Game.DoesNotExist:
            return None
    
    @database_sync_to_async
    def get_moves(self):
        from .models import Move
        return list(Move.objects.filter(game_id=self.game_id).order_by('move_number', 'id'))
    
    @database_sync_to_async
    def save_move(self, game, from_sq, to_sq, result, color):
        from .models import Move
        move_num = (game.move_count // 2) + 1
        time_left = game.white_time_left if color == 'white' else game.black_time_left
        
        captured = result.get('captured', '')
        
        return Move.objects.create(
            game=game,
            move_number=move_num,
            color=color,
            from_square=from_sq,
            to_square=to_sq,
            piece=result['piece'],
            captured_piece=captured,
            promotion=result.get('promotion', ''),
            algebraic_notation=result['notation'],
            fen_after=result['fen'],
            is_check=result.get('is_check', False),
            is_checkmate=result.get('is_checkmate', False),
            time_spent=0,
            time_left=time_left,
        )
    
    @database_sync_to_async
    def update_game_state(self, game_id, fen, status, white_time, black_time):
        from .models import Game
        
        game = Game.objects.get(game_id=game_id)
        game.current_fen = fen
        game.move_count += 1
        game.current_turn = 'black' if game.current_turn == 'white' else 'white'
        game.white_time_left = white_time
        game.black_time_left = black_time
        
        if status and status != 'ongoing':
            game.status = status
            game.ended_at = timezone.now()
        
        game.save()
    
    @database_sync_to_async
    def end_game(self, game_id, status, result, winner, termination):
        from .models import Game
        
        game = Game.objects.get(game_id=game_id)
        game.status = status
        game.result = result
        game.winner = winner
        game.termination = termination
        game.ended_at = timezone.now()
        
        # Calculate rating changes
        if result != '1/2-1/2':
            white_change, black_change = self._calculate_rating_changes(
                game.white_rating_before,
                game.black_rating_before,
                result
            )
            
            game.white_rating_after = game.white_rating_before + white_change
            game.black_rating_after = game.black_rating_before + black_change
            
            game.white_player.rating = game.white_rating_after
            game.black_player.rating = game.black_rating_after
            
            if result == '1-0':
                game.white_player.games_won += 1
                game.black_player.games_lost += 1
            else:
                game.black_player.games_won += 1
                game.white_player.games_lost += 1
            
            game.white_player.games_played += 1
            game.black_player.games_played += 1
            
            game.white_player.save()
            game.black_player.save()
        else:
            game.white_rating_after = game.white_rating_before
            game.black_rating_after = game.black_rating_before
            
            game.white_player.games_drawn += 1
            game.black_player.games_drawn += 1
            game.white_player.games_played += 1
            game.black_player.games_played += 1
            
            game.white_player.save()
            game.black_player.save()
        
        game.save()
    
    def _calculate_rating_changes(self, white_rating, black_rating, result):
        K = 32
        expected_white = 1 / (1 + 10 ** ((black_rating - white_rating) / 400))
        expected_black = 1 - expected_white
        
        if result == '1-0':
            actual_white, actual_black = 1, 0
        else:
            actual_white, actual_black = 0, 1
        
        white_change = round(K * (actual_white - expected_white))
        black_change = round(K * (actual_black - expected_black))
        
        return white_change, black_change


class GameClockManager:
    """Redis-based clock manager"""
    _instances = {}
    
    @classmethod
    def get_or_create(cls, game_id, redis_client):
        if game_id not in cls._instances:
            cls._instances[game_id] = cls(game_id, redis_client)
        return cls._instances[game_id]
    
    def __init__(self, game_id, redis_client):
        self.game_id = game_id
        self.redis = redis_client
        self.task = None
        self.last_tick = None
        self.subscribers = set()
    
    async def subscribe(self, channel_name):
        self.subscribers.add(channel_name)
        if not self.task or self.task.done():
            self.task = asyncio.create_task(self._tick_loop())
    
    async def unsubscribe(self, channel_name):
        self.subscribers.discard(channel_name)
        if not self.subscribers and self.task:
            self.task.cancel()
    
    async def _tick_loop(self):
        from channels.layers import get_channel_layer
        from .models import Game
        
        channel_layer = get_channel_layer()
        self.last_tick = datetime.now()
        
        try:
            while self.subscribers:
                await asyncio.sleep(1)
                
                try:
                    game = await self._get_game()
                except:
                    break
                
                if game.status != 'ongoing':
                    break
                
                now = datetime.now()
                elapsed_ms = int((now - self.last_tick).total_seconds() * 1000)
                self.last_tick = now
                
                if game.current_turn == 'white':
                    game.white_time_left = max(0, game.white_time_left - elapsed_ms)
                    time_out = game.white_time_left == 0
                else:
                    game.black_time_left = max(0, game.black_time_left - elapsed_ms)
                    time_out = game.black_time_left == 0
                
                await self._save_time(game)
                
                # Publish clock to Redis
                clock_event = {
                    'type': 'clock_sync',
                    'white_time': game.white_time_left,
                    'black_time': game.black_time_left,
                }
                await self.redis.publish(f"game:{self.game_id}:clock", json.dumps(clock_event))
                
                # Also send via channel layer for direct subscribers
                await channel_layer.group_send(
                    f'game_{self.game_id}',
                    {
                        'type': 'clock_tick',
                        'white_time': game.white_time_left,
                        'black_time': game.black_time_left,
                    }
                )
                
                if time_out:
                    await self._handle_timeout(game)
                    break
                    
        except asyncio.CancelledError:
            pass
    
    @database_sync_to_async
    def _get_game(self):
        from .models import Game
        return Game.objects.get(game_id=self.game_id)
    
    @database_sync_to_async
    def _save_time(self, game):
        game.save(update_fields=['white_time_left', 'black_time_left'])
    
    async def _handle_timeout(self, game):
        """Handle timeout"""
        if game.white_time_left == 0:
            winner = game.black_player
            winner_color = 'black'
            result = '0-1'
        else:
            winner = game.white_player
            winner_color = 'white'
            result = '1-0'
        
        await self._end_game_on_timeout(game.game_id, result, winner)
        
        # Publish timeout event to Redis
        timeout_event = {
            'type': 'game_ended',
            'status': 'completed',
            'winner': winner_color,
            'termination': 'timeout',
            'result': result,
            'message': f'{winner.username} won on time'
        }
        await self.redis.publish(f"game:{self.game_id}:events", json.dumps(timeout_event))
    
    @database_sync_to_async
    def _end_game_on_timeout(self, game_id, result, winner):
        from .models import Game
        
        game = Game.objects.get(game_id=game_id)
        game.status = 'completed'
        game.result = result
        game.winner = winner
        game.termination = 'timeout'
        game.ended_at = timezone.now()
        
        K = 32
        expected_white = 1 / (1 + 10 ** ((game.black_rating_before - game.white_rating_before) / 400))
        
        if result == '1-0':
            actual_white, actual_black = 1, 0
        else:
            actual_white, actual_black = 0, 1
        
        white_change = round(K * (actual_white - expected_white))
        black_change = round(K * (actual_black - (1 - expected_white)))
        
        game.white_rating_after = game.white_rating_before + white_change
        game.black_rating_after = game.black_rating_before + black_change
        
        game.white_player.rating = game.white_rating_after
        game.black_player.rating = game.black_rating_after
        
        if result == '1-0':
            game.white_player.games_won += 1
            game.black_player.games_lost += 1
        else:
            game.black_player.games_won += 1
            game.white_player.games_lost += 1
        
        game.white_player.games_played += 1
        game.black_player.games_played += 1
        
        game.white_player.save()
        game.black_player.save()
        game.save()


class MatchmakingConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for matchmaking
    FIXED: Implements hybrid Redis/Celery approach to prevent 'Ghost Players' and bottlenecks
    """
    
    async def connect(self):
        self.user = self.scope['user']
        
        if not self.user.is_authenticated:
            await self.close()
            return
        
        # Join personal user group for notifications (Specific to Fix)
        self.user_group = f"user_{self.user.id}"
        await self.channel_layer.group_add(self.user_group, self.channel_name)
        
        await self.accept()
        
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'message': 'Connected to matchmaking service'
        }))
        
        print(f"{self.user.username} connected to matchmaking")
    
    async def disconnect(self, close_code):
        # FIX: THE GHOST PLAYER cleanup
        # Instantly remove user from all potential queues via Direct Redis
        if redis_client:
            try:
                # Using scan to find queues is safer than keys() in production
                cursor = '0'
                while cursor != 0:
                    cursor, keys = redis_client.scan(cursor=cursor, match="matchmaking:*", count=100)
                    for key in keys:
                        redis_client.srem(key, self.user.id)
            except Exception as e:
                print(f"Cleanup Error: {e}")

        # Remove from personal group
        await self.channel_layer.group_discard(self.user_group, self.channel_name)
        print(f"🔌 {self.user.username} disconnected from matchmaking")
    
    async def receive(self, text_data):
        """Handle incoming WebSocket messages"""
        try:
            data = json.loads(text_data)
            action = data.get('action')
            
            if action == 'join_queue':
                await self.handle_join_queue(data)
            elif action == 'leave_queue':
                await self.handle_leave_queue(data)
            elif action == 'get_queue_status':
                await self.handle_queue_status(data)
            else:
                await self.send(json.dumps({
                    'type': 'error',
                    'message': f'Unknown action: {action}'
                }))
                
        except json.JSONDecodeError:
            await self.send(json.dumps({
                'type': 'error',
                'message': 'Invalid JSON'
            }))
    
    # Find handle_join_queue method and REPLACE the Redis block:

    async def handle_join_queue(self, data):
        """Join matchmaking queue - Fixed for Data Integrity"""
        time_control = data.get('time_control', '10+0')
        self.current_time_control = time_control

        # [FIX START] Create a standardized JSON entry matching tasks.py expectation
        from django.utils import timezone
        queue_entry = json.dumps({
            'user_id': self.user.id,
            'rating': self.user.rating, 
            'channel_name': self.channel_name,
            'timestamp': timezone.now().isoformat()
        })
        
        if redis_client:
            queue_key = f"matchmaking:{time_control}"
            # Use the JSON entry, NOT just the ID
            redis_client.sadd(queue_key, queue_entry) 
            
            await self.send(json.dumps({
                'type': 'matchmaking.queued', 
                'time_control': time_control,
                'message': 'Searching for opponent...'
            }))

        rating = self.user.rating if hasattr(self.user, 'rating') else await self.get_user_rating()
        find_match.delay(
            user_id=self.user.id,
            time_control=time_control,
            rating=rating,
            channel_name=self.channel_name
        )
        
        print(f"🔍 {self.user.username} joining queue for {time_control}")
    
    async def handle_leave_queue(self, data):
        """Leave matchmaking queue"""
        time_control = data.get('time_control') or getattr(self, 'current_time_control', None)
        
        if time_control and redis_client:
            redis_client.srem(f"matchmaking:{time_control}", self.user.id)
            await self.send(json.dumps({'type': 'matchmaking.left'}))
            
            # Also notify Celery to clean up any pending tasks
            leave_queue.delay(
                user_id=self.user.id,
                time_control=time_control,
                channel_name=self.channel_name
            )
            print(f"🚪 {self.user.username} leaving queue for {time_control}")
    
    async def handle_queue_status(self, data):
        """Get current queue status - Restored from Original"""
        time_control = data.get('time_control', '10+0')
        count = 0
        
        if redis_client:
            queue_key = f"matchmaking:{time_control}"
            count = redis_client.scard(queue_key)
        
        await self.send(json.dumps({
            'type': 'queue_status',
            'time_control': time_control,
            'players_in_queue': count
        }))

    # Channel Layer Handlers (called by Celery tasks)
    
    async def matchmaking_found(self, event):
        """Match found! Redirect to game"""
        await self.send(json.dumps({
            'type': 'match_found',
            'game_id': event['game_id'],
            'color': event['color'],
            'message': 'Match found! Starting game...'
        }))
    
    async def matchmaking_queued(self, event):
        """User added to queue"""
        await self.send(json.dumps({
            'type': 'queue_joined',
            'time_control': event['time_control'],
            'message': event['message']
        }))
    
    async def matchmaking_left(self, event):
        """User left queue"""
        await self.send(json.dumps({
            'type': 'queue_left',
            'message': event['message']
        }))
    
    async def matchmaking_timeout(self, event):
        """Matchmaking timed out"""
        await self.send(json.dumps({
            'type': 'timeout',
            'message': event['message']
        }))
    
    async def matchmaking_error(self, event):
        """Matchmaking error"""
        await self.send(json.dumps({
            'type': 'error',
            'message': event['message']
        }))
    
    # Database Queries
    @database_sync_to_async
    def get_user_rating(self):
        return self.user.rating