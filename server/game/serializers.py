from rest_framework import serializers
from django.utils import timezone
from .models import Game, GameChallenge

class PlayerSerializer(serializers.Serializer):
    """
    Lightweight user serializer for games and challenges.
    Replaces the heavy accounts.UserSerializer to keep JSON payloads small.
    """
    id = serializers.IntegerField()
    username = serializers.CharField()
    rating = serializers.IntegerField()
    # avatar = serializers.ImageField(required=False) # Uncomment if you use avatars

class GameSerializer(serializers.ModelSerializer):
    """
    Detailed game serializer including the full UCI move history.
    Used when a user or spectator loads a specific game page.
    """
    white_player = PlayerSerializer(read_only=True)
    black_player = PlayerSerializer(read_only=True)
    move_count = serializers.SerializerMethodField()
    duration = serializers.SerializerMethodField()
    
    class Meta:
        model = Game
        fields = [
            'game_id', 'white_player', 'black_player', 'time_control',
            'initial_time', 'increment', 'status', 'result', 'winner',
            'termination', 'initial_fen', 'final_fen', 'pgn', 'move_history',
            'created_at', 'started_at', 'ended_at', 
            'white_rating_before', 'black_rating_before',
            'white_rating_after', 'black_rating_after',
            'move_count', 'duration'
        ]
        
    def get_move_count(self, obj):
        # Calculate move count dynamically from the JSON array
        return len(obj.move_history) if obj.move_history else 0

    def get_duration(self, obj):
        if obj.started_at and obj.ended_at:
            return int((obj.ended_at - obj.started_at).total_seconds())
        return None

class GameListSerializer(serializers.ModelSerializer):
    """
    Ultra-lightweight serializer for lists (e.g., user profiles, spectator lobby).
    Excludes the heavy move_history and fen strings.
    """
    white_player = serializers.StringRelatedField()
    black_player = serializers.StringRelatedField()
    move_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Game
        fields = [
            'game_id', 'white_player', 'black_player', 'time_control',
            'status', 'result', 'created_at', 'move_count'
        ]

    def get_move_count(self, obj):
        return len(obj.move_history) if obj.move_history else 0

class GameChallengeSerializer(serializers.ModelSerializer):
    """Serializer for asynchronous friend challenges"""
    challenger = PlayerSerializer(read_only=True)
    challenged = PlayerSerializer(read_only=True)
    time_remaining = serializers.SerializerMethodField()
    
    class Meta:
        model = GameChallenge
        fields = [
            'id', 'challenger', 'challenged', 'time_control', 'status', 
            'game', 'created_at', 'expires_at', 'time_remaining'
        ]
        read_only_fields = ['status', 'game', 'created_at', 'expires_at']
    
    def get_time_remaining(self, obj):
        """Calculate remaining time in seconds before challenge auto-expires"""
        if obj.status != 'pending':
            return 0
        
        remaining = (obj.expires_at - timezone.now()).total_seconds()
        return max(0, int(remaining))