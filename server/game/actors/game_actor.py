import json
import time
import logging
import redis
from django.conf import settings
from thespian.actors import ActorTypeDispatcher, ActorExitRequest

from game.chess_engine import ChessEngine
from game.state import ActiveGameState, MoveNode

logger = logging.getLogger(__name__)

class GameActor(ActorTypeDispatcher):
    """
    Stateful actor responsible for a single game.
    Processes moves, manages the clock, and enforces rules via strict state objects.
    """
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.redis_client = None
        self.game_id = None

    def _get_redis(self):
        """Lazy initialization of the Redis client."""
        if not self.redis_client:
            redis_url = getattr(settings, 'REDIS_URL', 'redis://localhost:6379/0')
            self.redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
        return self.redis_client

    def receiveMsg_dict(self, message, sender):
        """Routes the structured dicts sent by the GameConsumer."""
        self.game_id = message.get('game_id')
        user_id = message.get('user_id')
        data = message.get('data', {})
        action = data.get('type')
        payload = data.get('payload', {})
        timestamp = message.get('timestamp', time.time())

        if action == 'join_game':
            self.handle_join()
        elif action == 'move':
            self.handle_move(user_id, payload, timestamp)
        elif action == 'resign':
            self.handle_resign(user_id)
        elif action == 'leave_game':
            pass
        elif action == 'chat':
            self.handle_chat(user_id, payload, timestamp)
        elif action == 'typing':
            self.handle_typing(payload)
        elif action == 'offer_draw':
            self.handle_offer_draw(user_id)
        elif action == 'accept_draw':
            self.handle_accept_draw(user_id)
        elif action == 'decline_draw':
            self.handle_decline_draw(user_id)
        elif action == 'request_takeback':
            self.handle_takeback(user_id)

    def _load_state(self) -> ActiveGameState:
        """Loads from Redis and instantiates the strict ActiveGameState object."""
        state_json = self._get_redis().get(f"game:{self.game_id}:state")
        if state_json:
            # Assuming ActiveGameState has a from_dict/from_json constructor
            return ActiveGameState.from_dict(json.loads(state_json))
        return None

    def _save_state(self, state: ActiveGameState):
        """Serializes the ActiveGameState object back to JSON for Redis."""
        # Assuming ActiveGameState has a to_dict() method
        self._get_redis().set(f"game:{self.game_id}:state", json.dumps(state.to_dict()))

    def _publish_event(self, event_data: dict):
        """Publishes an event to the game's Redis PubSub channel."""
        channel = f"game:{self.game_id}:events"
        self._get_redis().publish(channel, json.dumps(event_data))

    def _load_state(self) -> ActiveGameState:
        """Loads from Redis and instantiates the strict ActiveGameState object."""
        state_json = self._get_redis().get(f"game:{self.game_id}:state")
        if state_json:
            return ActiveGameState.from_dict(json.loads(state_json))
        return None

    def _get_or_create_state(self) -> ActiveGameState:
        """
        Attempts to load state from Redis. If missing, performs a ONE-TIME
        query to Postgres to hydrate the Redis cache.
        """
        state = self._load_state()
        if state:
            return state

        # one-time: query Postgres and hydrate Redis
        try:
            # query the database strictly once
            game_record = Game.objects.get(game_id=self.game_id)
            
            # construct the fully hydrated state object using DB fields
            state = ActiveGameState(
                game_id=self.game_id,
                white_player_id=str(game_record.white_player_id), 
                black_player_id=str(game_record.black_player_id),
                white_time_left=game_record.initial_time * 1000,
                black_time_left=game_record.initial_time * 1000,
                increment=game_record.increment,
                last_move_timestamp=time.time(),
                current_turn='white',
                current_fen=game_record.initial_fen,
                status=game_record.status,
                moves=[],
                termination=game_record.termination or None
            )
            
            # save it to redis so we never hit postgres again during gameplay
            self._save_state(state)
            return state
            
        except Game.DoesNotExist:
            logger.error(f"Game {self.game_id} not found in Postgres.")
            return None

    def _save_state(self, state: ActiveGameState):
        """Serializes the ActiveGameState object back to JSON for Redis."""
        self._get_redis().set(f"game:{self.game_id}:state", json.dumps(state.to_dict()))

    def _publish_event(self, event_data: dict):
        """Publishes an event to the game's Redis PubSub channel."""
        channel = f"game:{self.game_id}:events"
        self._get_redis().publish(channel, json.dumps(event_data))

    def handle_join(self):
        """Pushes the current state to a user who just connected."""
        state = self._get_or_create_state()
        if not state:
            return 
            
        state_dict = state.to_dict()

        # THE CLOCK FIX 
        # calculate time spent on the current turn so the UI clock is accurate on refresh
        if state.status == 'ongoing' and state.last_move_timestamp:
            current_time = time.time()
            time_spent_ms = int((current_time - state.last_move_timestamp) * 1000)
            
            if state.current_turn == 'white':
                state_dict['white_time_left'] = max(0, state.white_time_left - time_spent_ms)
            else:
                state_dict['black_time_left'] = max(0, state.black_time_left - time_spent_ms)
            
        self._publish_event({
            'type': 'game_sync',
            'state': state_dict 
        })

    def handle_move(self, user_id, payload, timestamp):
        """Core logic using the strict state models."""
        state = self._load_state()
        if not state or state.status != 'ongoing':
            return

        # 1. Verify Turn & Player via the object attributes
        is_white_turn = state.current_turn == 'white'
        expected_user_id = state.white_player_id if is_white_turn else state.black_player_id
        
        if user_id != expected_user_id:
            return 

        uci_move = payload.get('uci')
        if not uci_move:
            return

        # 2. Reconstruct Engine using the MoveNode objects
        try:
            move_history = [m.uci for m in state.moves]
            engine = ChessEngine.from_move_list(move_history)
        except Exception as e:
            logger.error(f"Engine reconstruction failed: {e}")
            return

        move_result = engine.play_uci_move(uci_move)
        if not move_result:
            return

        # 3. Clock Math updating the object state
        time_spent_ms = 0
        if state.last_move_timestamp:
            time_spent_ms = int((timestamp - state.last_move_timestamp) * 1000)
            
            if is_white_turn:
                state.white_time_left -= time_spent_ms
                if state.white_time_left <= 0:
                    self.end_game(state, 'timeout', 'black')
                    return
                state.white_time_left += state.increment * 1000
            else:
                state.black_time_left -= time_spent_ms
                if state.black_time_left <= 0:
                    self.end_game(state, 'timeout', 'white')
                    return
                state.black_time_left += state.increment * 1000

        # 4. Update State properties
        state.last_move_timestamp = timestamp
        state.current_turn = 'black' if is_white_turn else 'white'
        
        # Instantiate the strict MoveNode object
        new_move = MoveNode(
            uci=uci_move,
            notation=move_result.get('notation'),
            time_spent=time_spent_ms,
            time_left=state.white_time_left if is_white_turn else state.black_time_left,
            color='white' if is_white_turn else 'black',
            timestamp=timestamp,
            is_check=move_result.get('is_check', False),
            captured=move_result.get('captured', False)
        )
        state.moves.append(new_move)

        # 5. Save and Publish
        self._save_state(state)
        
        self._publish_event({
            'type': 'move_made',
            'move': new_move.to_dict(), # Serialize the node for the broadcast
            'white_time': state.white_time_left,
            'black_time': state.black_time_left
        })

        # 6. Check for Game Over
        if move_result.get('status') in ['checkmate', 'stalemate']:
            winner = 'white' if is_white_turn else 'black'
            if move_result.get('status') == 'stalemate':
                winner = None
            self.end_game(state, move_result.get('status'), winner)

    def handle_chat(self, user_id, payload, timestamp):
        """Broadcasts chat messages sent from ChatBox.jsx"""
        self._publish_event({
            'type': 'chat_message',
            'message': {
                'id': f"{time.time()}-{user_id}",
                'user': payload.get('user', 'Anonymous'),
                'text': payload.get('text', ''),
                'timestamp': payload.get('timestamp', timestamp),
                'is_system': False
            }
        })

    def handle_typing(self, payload):
        """Broadcasts typing indicators sent from ChatBox.jsx"""
        self._publish_event({
            'type': 'user_typing',
            'user': payload.get('user', 'Anonymous')
        })

    def handle_offer_draw(self, user_id):
        """Records a draw offer and alerts the opponent."""
        state = self._load_state()
        if not state or state.status != 'ongoing':
            return
            
        color = 'white' if user_id == state.white_player_id else 'black'
        state.draw_offer_by = color
        self._save_state(state)
        
        self._publish_event({
            'type': 'draw_offered',
            'by': color
        })

    def handle_accept_draw(self, user_id):
        """Validates and finalizes a draw agreement."""
        state = self._load_state()
        if not state or state.status != 'ongoing' or not state.draw_offer_by:
            return
            
        color = 'white' if user_id == state.white_player_id else 'black'
        
        # You cannot accept your own draw offer
        if color == state.draw_offer_by:
            return 
            
        self.end_game(state, 'agreement', None)

    def handle_decline_draw(self, user_id):
        """Clears the pending draw offer."""
        state = self._load_state()
        if not state or state.status != 'ongoing':
            return
            
        state.draw_offer_by = None
        self._save_state(state)
        
        self._publish_event({
            'type': 'draw_declined'
        })

    def handle_takeback(self, user_id):
        """Pops the last move, mathematically reverts the clock, and forces a sync."""
        state = self._load_state()
        if not state or state.status != 'ongoing' or not state.moves:
            return
            
        # Pop the last move
        last_move = state.moves.pop()
        
        # Revert the turn marker
        state.current_turn = last_move.color
        
        # Mathematically revert the clock: add spent time back, remove the increment that was granted
        if last_move.color == 'white':
            state.white_time_left += last_move.time_spent
            state.white_time_left -= (state.increment * 1000)
        else:
            state.black_time_left += last_move.time_spent
            state.black_time_left -= (state.increment * 1000)
            
        # Reset the move timestamp so UI clocks don't heavily penalize the player upon sync
        state.last_move_timestamp = time.time() 
        state.takeback_request_by = None
        
        self._save_state(state)
        
        # Broadcast the entire state to overwrite the frontend boards and clocks
        self._publish_event({
            'type': 'game_sync',
            'state': state.to_dict()
        })

    def handle_resign(self, user_id):
        state = self._load_state()
        if not state or state.status != 'ongoing':
            return
            
        resigning_color = 'white' if user_id == state.white_player_id else 'black'
        winner_color = 'black' if resigning_color == 'white' else 'white'
        
        self.end_game(state, 'resignation', winner_color)

    def end_game(self, state: ActiveGameState, termination: str, winner_color: str):
        """Handles game conclusion, triggers DB write, and kills the Actor."""
        state.status = 'completed'
        state.termination = termination
        self._save_state(state)
        
        self._publish_event({
            'type': 'game_ended',
            'status': state.status,
            'termination': termination,
            'winner': winner_color
        })

        # Send final structured state to the Postgres DB Actor
        from game.actors.db_actor import PostgresWriterActor
        db_actor = self.createActor(PostgresWriterActor, globalName="postgres_writer")
        self.send(db_actor, {
            'action': 'save_game',
            'game_id': self.game_id,
            'final_state': state.to_dict(),
            'winner_color': winner_color
        })

        self.send(self.myAddress, ActorExitRequest())