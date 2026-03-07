import logging
from django.utils import timezone
from thespian.actors import ActorTypeDispatcher

logger = logging.getLogger(__name__)

class PostgresWriterActor(ActorTypeDispatcher):
    """
    Dedicated actor for asynchronous database writes.
    Frees up the GameActor and intercepts Postgres latency.
    """
    
    def receiveMsg_dict(self, message, sender):
        action = message.get('action')
        if action == 'save_game':
            self.save_game(
                game_id=message.get('game_id'),
                final_state_dict=message.get('final_state'),
                winner_color=message.get('winner_color')
            )

    def save_game(self, game_id: str, final_state_dict: dict, winner_color: str):
        # Lazy imports to ensure Django apps are fully loaded in this process
        from game.models import Game
        from django.db import transaction
        
        try:
            # Atomic block ensures ratings and game state succeed or fail together
            with transaction.atomic():
                game = Game.objects.select_related('white_player', 'black_player').get(game_id=game_id)
                
                # 1. Update Final Status
                game.status = final_state_dict.get('status', 'completed')
                game.termination = final_state_dict.get('termination', '')
                game.final_fen = final_state_dict.get('current_fen', '')
                
                # 2. Store lightweight UCI move history natively
                # Extracting just the 'uci' strings from the serialized MoveNode dicts
                game.move_history = [move['uci'] for move in final_state_dict.get('moves', [])]
                
                # 3. Map Result
                if winner_color == 'white':
                    game.result = '1-0'
                    game.winner = game.white_player
                elif winner_color == 'black':
                    game.result = '0-1'
                    game.winner = game.black_player
                else:
                    game.result = '1/2-1/2'
                    game.winner = None
                    
                # 4. Calculate and apply Elo ratings
                self._update_ratings(game)
                
                game.ended_at = timezone.now()
                game.save()
                
                logger.info(f"Successfully persisted game {game_id} to Postgres.")
                
        except Game.DoesNotExist:
            logger.error(f"Game {game_id} not found for DB persistence.")
        except Exception as e:
            logger.error(f"Error persisting game {game_id}: {e}")

    def _update_ratings(self, game):
        """Calculates and updates Elo ratings based on the result."""
        K = 32
        expected_white = 1 / (1 + 10 ** ((game.black_rating_before - game.white_rating_before) / 400))
        expected_black = 1 - expected_white
        
        if game.result == '1-0':
            actual_white, actual_black = 1, 0
        elif game.result == '0-1':
            actual_white, actual_black = 0, 1
        else:
            actual_white, actual_black = 0.5, 0.5
        
        white_change = round(K * (actual_white - expected_white))
        black_change = round(K * (actual_black - expected_black))
        
        game.white_rating_after = game.white_rating_before + white_change
        game.black_rating_after = game.black_rating_before + black_change
        
        # Safely update User models
        game.white_player.rating = game.white_rating_after
        game.black_player.rating = game.black_rating_after
        
        # update_fields is a minor optimization to prevent writing untouched user columns
        game.white_player.save(update_fields=['rating'])
        game.black_player.save(update_fields=['rating'])