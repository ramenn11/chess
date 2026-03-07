from django.db import models
from django.utils import timezone
from accounts.models import User
import uuid

class Game(models.Model):
    STATUS_CHOICES = [
        ('waiting', 'Waiting'),
        ('ongoing', 'Ongoing'),
        ('completed', 'Completed'),
        ('abandoned', 'Abandoned'),
    ]
    
    RESULT_CHOICES = [
        ('1-0', 'White Wins'),
        ('0-1', 'Black Wins'),
        ('1/2-1/2', 'Draw'),
        ('*', 'Ongoing'),
    ]
    
    game_id = models.CharField(max_length=50, unique=True, primary_key=True)
    white_player = models.ForeignKey(User, on_delete=models.CASCADE, related_name='games_as_white')
    black_player = models.ForeignKey(User, on_delete=models.CASCADE, related_name='games_as_black')
    
    time_control = models.CharField(max_length=10)
    initial_time = models.IntegerField()
    increment = models.IntegerField()
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='waiting')
    result = models.CharField(max_length=10, choices=RESULT_CHOICES, default='*')
    winner = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='won_games')
    termination = models.CharField(max_length=50, blank=True)
    
    initial_fen = models.TextField(default='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    final_fen = models.TextField(blank=True, null=True) 
    pgn = models.TextField(blank=True, help_text="Generated and saved only when the game concludes.")
    
    move_history = models.JSONField(default=list, blank=True, help_text="List of UCI moves saved at game end.")
    
    created_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    
    white_rating_before = models.IntegerField(default=1200)
    black_rating_before = models.IntegerField(default=1200)
    white_rating_after = models.IntegerField(null=True, blank=True)
    black_rating_after = models.IntegerField(null=True, blank=True)
    
    class Meta:
        db_table = 'games'
        ordering = ['-created_at']
        
    def __str__(self):
        return f"{self.game_id} - {self.white_player.username} vs {self.black_player.username}"

    @classmethod
    def generate_game_id(cls):
        timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
        random_str = uuid.uuid4().hex[:8]
        return f"{timestamp}_{random_str}"


class GameChallenge(models.Model):
    """Kept this for asynchronous friend challenges, which still need persistent state."""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('accepted', 'Accepted'),
        ('rejected', 'Rejected'),
        ('expired', 'Expired'),
    ]
    
    challenger = models.ForeignKey(User, on_delete=models.CASCADE, related_name='challenges_sent')
    challenged = models.ForeignKey(User, on_delete=models.CASCADE, related_name='challenges_received')
    time_control = models.CharField(max_length=10)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    game = models.ForeignKey(Game, on_delete=models.SET_NULL, null=True, blank=True, related_name='challenge')
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    
    class Meta:
        db_table = 'game_challenges'