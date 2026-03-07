import os
import logging
from django.conf import settings
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from accounts.models import User
from game.models import Game
import redis

logger = logging.getLogger(__name__)

class Matchmaker:
    def __init__(self):
        redis_url = getattr(settings, 'REDIS_URL', 'redis://localhost:6379/0')
        self.redis = redis.Redis.from_url(redis_url, decode_responses=True)
        
        # Load and cache the Lua script in Redis for extremely fast execution
        script_path = os.path.join(os.path.dirname(__file__), 'matchmaking.lua')
        with open(script_path, 'r') as f:
            self.match_script = self.redis.register_script(f.read())

    def process_queue(self, user_id: str, rating: int, time_control: str):
        """Executes the Lua script and handles the result."""
        queue_key = f"matchmaking:{time_control}"
        
        # Execute the Lua script atomically
        matched_opponent_id = self.match_script(
            keys=[queue_key],
            args=[user_id, rating, 200] # 200 is the rating variance
        )
        
        if matched_opponent_id:
            # We have a match! Build the game in Postgres.
            self._create_and_notify(user_id, matched_opponent_id, time_control)
            return True
        return False

    def _create_and_notify(self, p1_id, p2_id, time_control):
        try:
            p1 = User.objects.get(id=p1_id)
            p2 = User.objects.get(id=p2_id)
            
            parts = time_control.split('+')
            initial_time = int(parts[0]) * 60
            increment = int(parts[1]) if len(parts) > 1 else 0
            
            # 1. Create Game
            game = Game.objects.create(
                game_id=Game.generate_game_id(),
                white_player=p1,
                black_player=p2,
                time_control=time_control,
                initial_time=initial_time,
                increment=increment,
                status='ongoing',
                white_rating_before=p1.rating,
                black_rating_before=p2.rating,
                started_at=timezone.now()
            )
            
            # 2. Notify Both Players via Channels
            channel_layer = get_channel_layer()
            
            async_to_sync(channel_layer.group_send)(
                f"user_{p1.id}",
                {'type': 'match_found', 'game_id': game.game_id, 'color': 'white'}
            )
            async_to_sync(channel_layer.group_send)(
                f"user_{p2.id}",
                {'type': 'match_found', 'game_id': game.game_id, 'color': 'black'}
            )
            
            logger.info(f"Match created: {game.game_id}")
            
        except Exception as e:
            logger.error(f"Failed to create match after queue pop: {e}")