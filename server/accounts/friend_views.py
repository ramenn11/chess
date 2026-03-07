from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.db.models import Q
from django.contrib.auth import get_user_model
from .models import Friendship, FriendRequest
from .friend_serializers import FriendshipSerializer, FriendRequestSerializer, FriendUserSerializer
from .redis_pubsub import notify_user_via_channel

User = get_user_model()


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_friends(request):
    """Get all friends with online status and game info"""
    friendships = Friendship.objects.filter(
        Q(user1=request.user) | Q(user2=request.user)
    ).select_related('user1', 'user2')
    
    friends_data = []
    for friendship in friendships:
        # Get the friend (the other user in the friendship)
        friend = friendship.user2 if friendship.user1 == request.user else friendship.user1
        
        friend_info = FriendUserSerializer(friend).data
        
        # Check if friend is in an active game
        from game.models import Game
        active_game = Game.objects.filter(
            status='ongoing'
        ).filter(
            Q(white_player=friend) | Q(black_player=friend)
        ).first()
        
        if active_game:
            friend_info['in_game'] = True
            friend_info['game_id'] = active_game.game_id
        else:
            friend_info['in_game'] = False
        
        friends_data.append(friend_info)
    
    # Sort: online first, then by rating
    friends_data.sort(key=lambda x: (not x['is_online'], -x['rating']))
    
    return Response({
        'friends': friends_data,
        'count': len(friends_data)
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_friend_requests(request):
    """Get pending friend requests (both sent and received)"""
    # Received requests
    received_requests = FriendRequest.objects.filter(
        to_user=request.user,
        status='pending'
    ).select_related('from_user').order_by('-created_at')
    
    # Sent requests
    sent_requests = FriendRequest.objects.filter(
        from_user=request.user,
        status='pending'
    ).select_related('to_user').order_by('-created_at')
    
    received_data = []
    for req in received_requests:
        received_data.append({
            'id': req.id,
            'user': FriendUserSerializer(req.from_user).data,
            'created_at': req.created_at.isoformat(),
            'type': 'received'
        })
    
    sent_data = []
    for req in sent_requests:
        sent_data.append({
            'id': req.id,
            'user': FriendUserSerializer(req.to_user).data,
            'created_at': req.created_at.isoformat(),
            'type': 'sent'
        })
    
    return Response({
        'received': received_data,
        'sent': sent_data,
        'total_received': len(received_data),
        'total_sent': len(sent_data)
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_friend_request(request):
    """Send a friend request to another user"""
    username = request.data.get('username')
    
    if not username:
        return Response(
            {'error': 'Username is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        to_user = User.objects.get(username=username)
    except User.DoesNotExist:
        return Response(
            {'error': 'User not found'},
            status=status.HTTP_404_NOT_FOUND
        )
    
    # Can't send request to yourself
    if to_user == request.user:
        return Response(
            {'error': 'Cannot send friend request to yourself'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Check if already friends
    existing_friendship = Friendship.objects.filter(
        Q(user1=request.user, user2=to_user) |
        Q(user1=to_user, user2=request.user)
    ).exists()
    
    if existing_friendship:
        return Response(
            {'error': 'Already friends with this user'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Check if request already exists (in either direction)
    existing_request = FriendRequest.objects.filter(
        Q(from_user=request.user, to_user=to_user) |
        Q(from_user=to_user, to_user=request.user),
        status='pending'
    ).first()
    
    if existing_request:
        if existing_request.from_user == request.user:
            return Response(
                {'error': 'Friend request already sent'},
                status=status.HTTP_400_BAD_REQUEST
            )
        else:
            # They sent us a request, auto-accept it
            existing_request.status = 'accepted'
            existing_request.save()
            
            Friendship.objects.create(
                user1=request.user,
                user2=to_user
            )
            
            # Notify both users
            notify_user_via_channel(to_user.id, {
                'type': 'friend_request_accepted',
                'accepted_by': {
                    'id': request.user.id,
                    'username': request.user.username,
                }
            })
            
            return Response({
                'message': 'Friend request automatically accepted',
                'friend': FriendUserSerializer(to_user).data
            }, status=status.HTTP_201_CREATED)
    
    # Create new friend request
    friend_request = FriendRequest.objects.create(
        from_user=request.user,
        to_user=to_user
    )
    
    # Notify receiver
    notify_user_via_channel(to_user.id, {
        'type': 'friend_request_received',
        'request_id': friend_request.id,
        'from_user': {
            'id': request.user.id,
            'username': request.user.username,
            'avatar': request.user.avatar.url if request.user.avatar else None,
            'rating': request.user.rating,
        },
        'created_at': friend_request.created_at.isoformat(),
    })
    
    return Response({
        'message': 'Friend request sent',
        'request_id': friend_request.id
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_friend_request(request):
    """Accept a friend request"""
    request_id = request.data.get('request_id')
    
    if not request_id:
        return Response(
            {'error': 'request_id is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    friend_request = get_object_or_404(
        FriendRequest,
        id=request_id,
        to_user=request.user,
        status='pending'
    )
    
    # Update request status
    friend_request.status = 'accepted'
    friend_request.save()
    
    # Create friendship
    Friendship.objects.create(
        user1=friend_request.from_user,
        user2=friend_request.to_user
    )
    
    # Notify sender
    notify_user_via_channel(friend_request.from_user.id, {
        'type': 'friend_request_accepted',
        'accepted_by': {
            'id': request.user.id,
            'username': request.user.username,
        }
    })
    
    return Response({
        'message': 'Friend request accepted',
        'friend': FriendUserSerializer(friend_request.from_user).data
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reject_friend_request(request):
    """Reject a friend request"""
    request_id = request.data.get('request_id')
    
    if not request_id:
        return Response(
            {'error': 'request_id is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    friend_request = get_object_or_404(
        FriendRequest,
        id=request_id,
        to_user=request.user,
        status='pending'
    )
    
    friend_request.status = 'rejected'
    friend_request.save()
    
    return Response({'message': 'Friend request rejected'})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def remove_friend(request, user_id):
    """Remove a friend"""
    try:
        friend = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response(
            {'error': 'User not found'},
            status=status.HTTP_404_NOT_FOUND
        )
    
    friendship = Friendship.objects.filter(
        Q(user1=request.user, user2=friend) |
        Q(user1=friend, user2=request.user)
    ).first()
    
    if not friendship:
        return Response(
            {'error': 'Not friends with this user'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    friendship.delete()
    return Response({'message': 'Friend removed'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def search_users(request):
    """Search for users by username with enhanced info"""
    query = request.query_params.get('q', '').strip()
    
    if not query:
        return Response({
            'results': [],
            'message': 'Please provide a search query'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if len(query) < 2:
        return Response({
            'results': [],
            'message': 'Query must be at least 2 characters'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Search users
    users = User.objects.filter(
        username__icontains=query
    ).exclude(
        id=request.user.id
    ).order_by('-rating')[:20]  # Top 20 results
    
    # Get current user's friend IDs
    friend_ids = set()
    friendships = Friendship.objects.filter(
        Q(user1=request.user) | Q(user2=request.user)
    ).values_list('user1_id', 'user2_id')
    
    for user1_id, user2_id in friendships:
        friend_ids.add(user1_id)
        friend_ids.add(user2_id)
    friend_ids.discard(request.user.id)
    
    # Get pending request IDs
    pending_request_ids = set()
    pending_requests = FriendRequest.objects.filter(
        Q(from_user=request.user) | Q(to_user=request.user),
        status='pending'
    ).values_list('from_user_id', 'to_user_id')
    
    for from_id, to_id in pending_requests:
        pending_request_ids.add(from_id)
        pending_request_ids.add(to_id)
    pending_request_ids.discard(request.user.id)
    
    # Build results with friendship status
    results = []
    for user in users:
        user_data = FriendUserSerializer(user).data
        
        # Determine relationship status
        if user.id in friend_ids:
            user_data['friendship_status'] = 'friend'
        elif user.id in pending_request_ids:
            # Check direction
            sent_request = FriendRequest.objects.filter(
                from_user=request.user,
                to_user=user,
                status='pending'
            ).exists()
            
            received_request = FriendRequest.objects.filter(
                from_user=user,
                to_user=request.user,
                status='pending'
            ).exists()
            
            if sent_request:
                user_data['friendship_status'] = 'request_sent'
            elif received_request:
                user_data['friendship_status'] = 'request_received'
            else:
                user_data['friendship_status'] = 'none'
        else:
            user_data['friendship_status'] = 'none'
        
        results.append(user_data)
    
    return Response({
        'results': results,
        'count': len(results)
    })