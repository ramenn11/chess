from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.utils import timezone
from datetime import timedelta
from django.contrib.auth import get_user_model
from .models import GameChallenge, Game
from .challenge_serializers import GameChallengeSerializer

User = get_user_model()


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_challenge(request):
    """Send a game challenge to another user"""
    friend_id = request.data.get('friend_id')
    time_control = request.data.get('time_control', '5+0')
    
    if not friend_id:
        return Response(
            {'error': 'friend_id is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        challenged_user = User.objects.get(id=friend_id)
    except User.DoesNotExist:
        return Response(
            {'error': 'User not found'},
            status=status.HTTP_404_NOT_FOUND
        )
    
    # Check if user is challenging themselves
    if challenged_user == request.user:
        return Response(
            {'error': 'Cannot challenge yourself'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Check for existing pending challenge
    existing_challenge = GameChallenge.objects.filter(
        challenger=request.user,
        challenged=challenged_user,
        status='pending'
    ).first()
    
    if existing_challenge:
        return Response(
            {'error': 'Challenge already pending'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Create challenge
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
    # Get challenges received
    received = GameChallenge.objects.filter(
        challenged=request.user,
        status='pending',
        expires_at__gt=timezone.now()
    ).select_related('challenger')
    
    # Get challenges sent
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
    """Accept a game challenge"""
    from .redis_pubsub import notify_user_via_channel
    
    challenge = get_object_or_404(
        GameChallenge,
        id=challenge_id,
        challenged=request.user,
        status='pending'
    )
    
    # Check if expired
    if challenge.expires_at <= timezone.now():
        challenge.status = 'expired'
        challenge.save()
        return Response(
            {'error': 'Challenge has expired'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Parse time control
    parts = challenge.time_control.split('+')
    initial_time = int(parts[0]) * 60
    increment = int(parts[1]) if len(parts) > 1 else 0
    
    # Create game
    game = Game.objects.create(
        game_id=Game.generate_game_id(),
        white_player=challenge.challenger,
        black_player=challenge.challenged,
        time_control=challenge.time_control,
        initial_time=initial_time,
        increment=increment,
        white_time_left=initial_time * 1000,
        black_time_left=initial_time * 1000,
        status='ongoing',
        started_at=timezone.now(),
        white_rating_before=challenge.challenger.rating,
        black_rating_before=challenge.challenged.rating
    )
    
    # Update challenge
    challenge.status = 'accepted'
    challenge.game = game
    challenge.save()
    
    # NOTIFY BOTH PLAYERS via WebSocket
    notification = {
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
    
    # Notify challenger (sender)
    notify_user_via_channel(challenge.challenger.id, notification)
    
    # Notify challenged (accepter)
    notify_user_via_channel(challenge.challenged.id, notification)
    
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