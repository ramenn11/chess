from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404
from django.utils import timezone
from datetime import timedelta
from django.contrib.auth import get_user_model
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

import json
from django.conf import settings
import redis

from .models import Game, GameChallenge
from .serializers import GameSerializer, GameListSerializer, GameChallengeSerializer

User = get_user_model()

redis_client = redis.Redis.from_url(
    getattr(settings, 'REDIS_URL', 'redis://localhost:6379/0'), 
    decode_responses=True
)

# game views

@api_view(['GET'])
@permission_classes([AllowAny])
def list_games(request):
    """List all games with filtering options"""
    games = Game.objects.all()
    
    status_filter = request.query_params.get('status')
    if status_filter:
        games = games.filter(status=status_filter)
    
    username = request.query_params.get('username')
    if username:
        games = games.filter(
            white_player__username=username
        ) | games.filter(
            black_player__username=username
        )
    
    serializer = GameListSerializer(games, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([AllowAny])
def get_game(request, game_id):
    """Get detailed game information"""
    game = get_object_or_404(Game, game_id=game_id)
    serializer = GameSerializer(game)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([AllowAny])
def get_game_moves(request, game_id):
    """
    Get all moves for a game. 
    Updated to return the lightweight JSON array of UCI strings instead of querying a Move table.
    """
    game = get_object_or_404(Game, game_id=game_id)
    return Response(game.move_history)


@api_view(['GET'])
@permission_classes([AllowAny])
def get_user_games(request, username):
    """Get all games for a specific user"""
    user = get_object_or_404(User, username=username)
    games = Game.objects.filter(
        white_player=user
    ) | Game.objects.filter(
        black_player=user
    )
    
    serializer = GameListSerializer(games.order_by('-created_at'), many=True)
    return Response(serializer.data)


# CHALLENGE VIEWS

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_challenge(request):
    """Send a game challenge to another user"""
    friend_id = request.data.get('friend_id')
    time_control = request.data.get('time_control', '5+0')
    
    if not friend_id:
        return Response({'error': 'friend_id is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        challenged_user = User.objects.get(id=friend_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    
    if challenged_user == request.user:
        return Response({'error': 'Cannot challenge yourself'}, status=status.HTTP_400_BAD_REQUEST)
    
    existing_challenge = GameChallenge.objects.filter(
        challenger=request.user,
        challenged=challenged_user,
        status='pending'
    ).first()
    
    if existing_challenge:
        return Response({'error': 'Challenge already pending'}, status=status.HTTP_400_BAD_REQUEST)
    
    challenge = GameChallenge.objects.create(
        challenger=request.user,
        challenged=challenged_user,
        time_control=time_control,
        expires_at=timezone.now() + timedelta(minutes=2)
    )
    
    serializer = GameChallengeSerializer(challenge)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_challenges(request):
    """Get all pending challenges for current user"""
    received = GameChallenge.objects.filter(
        challenged=request.user,
        status='pending',
        expires_at__gt=timezone.now()
    ).select_related('challenger')
    
    sent = GameChallenge.objects.filter(
        challenger=request.user,
        status='pending'
    ).select_related('challenged')
    
    # Expire old challenges
    GameChallenge.objects.filter(
        expires_at__lte=timezone.now(),
        status='pending'
    ).update(status='expired')
    
    return Response({
        'received': GameChallengeSerializer(received, many=True).data,
        'sent': GameChallengeSerializer(sent, many=True).data
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_challenge(request, challenge_id):
    """Accept a game challenge and initialize the DB record"""
    challenge = get_object_or_404(
        GameChallenge,
        id=challenge_id,
        challenged=request.user,
        status='pending'
    )
    
    if challenge.expires_at <= timezone.now():
        challenge.status = 'expired'
        challenge.save()
        return Response({'error': 'Challenge has expired'}, status=status.HTTP_400_BAD_REQUEST)
    
    parts = challenge.time_control.split('+')
    initial_time = int(parts[0]) * 60
    increment = int(parts[1]) if len(parts) > 1 else 0
    
    game = Game.objects.create(
        game_id=Game.generate_game_id(),
        white_player=challenge.challenger,
        black_player=challenge.challenged,
        time_control=challenge.time_control,
        initial_time=initial_time,
        increment=increment,
        status='ongoing',
        started_at=timezone.now(),
        white_rating_before=challenge.challenger.rating,
        black_rating_before=challenge.challenged.rating
    )
    
    challenge.status = 'accepted'
    challenge.game = game
    challenge.save()
    
    channel_layer = get_channel_layer()
    notification_payload = {
        'type': 'user_notification', # Maps to the method in UserNotificationConsumer
        'message': {
            'type': 'challenge_accepted',
            'game_id': game.game_id,
            'challenger': {
                'username': challenge.challenger.username,
                'color': 'white'
            },
            'challenged': {
                'username': challenge.challenged.username,
                'color': 'black'
            }
        }
    }
    
    # send to both users personal WebSocket groups
    async_to_sync(channel_layer.group_send)(f"user_{challenge.challenger.id}", notification_payload)
    async_to_sync(channel_layer.group_send)(f"user_{challenge.challenged.id}", notification_payload)
    
    return Response({
        'message': 'Challenge accepted',
        'game_id': game.game_id,
        'color': 'black'
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reject_challenge(request, challenge_id):
    """Reject a game challenge"""
    challenge = get_object_or_404(
        GameChallenge,
        id=challenge_id,
        challenged=request.user,
        status='pending'
    )
    
    challenge.status = 'rejected'
    challenge.save()
    return Response({'message': 'Challenge rejected'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cancel_challenge(request, challenge_id):
    """Cancel a sent challenge"""
    challenge = get_object_or_404(
        GameChallenge,
        id=challenge_id,
        challenger=request.user,
        status='pending'
    )
    
    challenge.status = 'expired'
    challenge.save()
    return Response({'message': 'Challenge cancelled'})

@api_view(['GET'])
@permission_classes([AllowAny])
def get_live_lobby_games(request):
    """Lobby Feed: Enriches ongoing DB games with live Redis stats"""
    ongoing_games = Game.objects.filter(status='ongoing').select_related('white_player', 'black_player')
    live_data = []

    for game in ongoing_games:
        # Fetch the live state from Redis (Assuming it's stored as a JSON string)
        state_raw = redis_client.get(f"game:{game.game_id}:state")
        
        if state_raw:
            state = json.loads(state_raw)
            live_data.append({
                'game_id': game.game_id,
                'white_player': {'username': game.white_player.username, 'rating': game.white_rating_before},
                'black_player': {'username': game.black_player.username, 'rating': game.black_rating_before},
                'time_control': game.time_control,
                'move_count': state.get('move_count', 0),
                'spectators': redis_client.pubsub_numsub(f"game:{game.game_id}:events")[0][1], # Count active WS subs
                'white_time_left': state.get('white_time', game.initial_time * 1000),
                'black_time_left': state.get('black_time', game.initial_time * 1000),
            })
            
    return Response(live_data)

@api_view(['GET'])
@permission_classes([AllowAny])
def get_live_game_snapshot(request, game_id):
    """Spectator Snapshot: Grabs the current FEN and clocks instantly"""
    state_raw = redis_client.get(f"game:{game_id}:state")
    if not state_raw:
        return Response({'error': 'Live game state not found'}, status=404)
        
    return Response(json.loads(state_raw))