import React, { useState, useEffect } from 'react';
import { Search, UserPlus, MessageCircle, Swords, Users, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import ChallengeModal from '../components/social/ChallengeModal';
import ChallengeNotification from '../components/social/ChallengeNotification';
import FriendSearch from '../components/social/FriendSearch';

function Friends() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [challenges, setChallenges] = useState({ received: [], sent: [] });

  // Challenge modal state
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState(null);

  useEffect(() => {
    fetchFriends();
    fetchFriendRequests();
    fetchChallenges();

    // Poll for challenges every 5 seconds
    const interval = setInterval(fetchChallenges, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchFriends = async () => {
    try {
      const response = await api.get('/auth/friends/');
      setFriends((response.friends || []).map(f => ({
        id: f.id,
        username: f.username,
        rating: f.rating,
        isOnline: f.is_online,
        lastSeen: new Date(f.last_seen),
        avatar: f.avatar,
      })));
    } catch (error) {
      console.error('Failed to fetch friends:', error);
    }
  };

  const fetchFriendRequests = async () => {
    try {
      const response = await api.get('/auth/friends/requests/');
      const requests = response.received || [];

      setFriendRequests(requests.map(r => ({
        id: r.id,
        username: r.user.username, // Note: backend serializer returns 'user' object inside
        rating: r.user.rating,
        sentAt: new Date(r.created_at),
      })));
    } catch (error) {
      console.error('Failed to fetch friend requests:', error);
    }
  };

  const fetchChallenges = async () => {
    try {
      const response = await api.get('/game/challenges/pending/');
      setChallenges(response);
    } catch (error) {
      console.error('Failed to fetch challenges:', error);
    }
  };



  const handleAcceptRequest = async (requestId) => {
    try {
      await api.post('/auth/friends/accept/', { request_id: requestId });
      setFriendRequests(prev => prev.filter(r => r.id !== requestId));
      fetchFriends();
    } catch (error) {
      console.error('Failed to accept friend request:', error);
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      await api.post('/auth/friends/reject/', { request_id: requestId });
      setFriendRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (error) {
      console.error('Failed to reject friend request:', error);
    }
  };

  const handleChallengeFriend = (friend) => {
    setSelectedFriend(friend);
    setShowChallengeModal(true);
  };

  const handleSendChallenge = async (friendId, timeControl) => {
    try {
      await api.post('/game/challenges/send/', {
        friend_id: friendId,
        time_control: timeControl
      });
      fetchChallenges();
      alert('Challenge sent!');
    } catch (error) {
      console.error('Failed to send challenge:', error);
      alert(error.message || 'Failed to send challenge');
    }
  };

  const handleAcceptChallenge = async (challengeId) => {
    try {
      const response = await api.post(`/game/challenges/accept/${challengeId}/`);
      navigate(`/game/${response.game_id}`);
    } catch (error) {
      console.error('Failed to accept challenge:', error);
      alert(error.message || 'Failed to accept challenge');
    }
  };

  const handleRejectChallenge = async (challengeId) => {
    try {
      await api.post(`/game/challenges/reject/${challengeId}/`);
      fetchChallenges();
    } catch (error) {
      console.error('Failed to reject challenge:', error);
    }
  };

  const getLastSeenText = (lastSeen) => {
    const diff = Date.now() - lastSeen.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="container mx-auto max-w-6xl">
      {/* Challenge Notifications */}
      {challenges.received.length > 0 && (
        <div className="fixed top-20 right-6 z-50 space-y-3 max-w-sm">
          {challenges.received.map((challenge) => (
            <ChallengeNotification
              key={challenge.id}
              challenge={challenge}
              onAccept={handleAcceptChallenge}
              onReject={handleRejectChallenge}
            />
          ))}
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Friends</h1>
            <p className="text-white/60">Connect with chess players and challenge your friends</p>
          </div>
          {challenges.received.length > 0 && (
            <div className="flex items-center space-x-2 bg-purple-600/20 border border-purple-500/50 rounded-lg px-4 py-2">
              <Bell className="w-5 h-5 text-purple-400 animate-pulse" />
              <span className="text-white font-semibold">{challenges.received.length} challenge(s)</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 mb-6">
        <button
          onClick={() => setActiveTab('friends')}
          className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'friends'
            ? 'bg-purple-600 text-white'
            : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
            }`}
        >
          <Users className="w-5 h-5" />
          <span>Friends ({friends.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'requests'
            ? 'bg-purple-600 text-white'
            : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
            }`}
        >
          <UserPlus className="w-5 h-5" />
          <span>Requests ({friendRequests.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-all ${activeTab === 'search'
            ? 'bg-purple-600 text-white'
            : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
            }`}
        >
          <Search className="w-5 h-5" />
          <span>Find Friends</span>
        </button>
      </div>

      {/* Content */}
      <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-6">
        {activeTab === 'friends' && (
          <div className="space-y-3">
            {friends.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-16 h-16 text-white/40 mx-auto mb-4" />
                <p className="text-white/60">No friends yet</p>
                <button
                  onClick={() => setActiveTab('search')}
                  className="mt-4 text-purple-400 hover:text-purple-300"
                >
                  Find friends to add
                </button>
              </div>
            ) : (
              friends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-lg p-4 transition-all"
                >
                  <div className="flex items-center space-x-4">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-lg font-bold">
                        {friend.username[0].toUpperCase()}
                      </div>
                      {friend.isOnline && (
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-slate-900"></div>
                      )}
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">{friend.username}</h3>
                      <div className="flex items-center space-x-2 text-sm text-white/60">
                        <span>{friend.rating} rating</span>
                        <span>•</span>
                        <span className={friend.isOnline ? 'text-green-400' : ''}>
                          {friend.isOnline ? 'Online' : getLastSeenText(friend.lastSeen)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      title="Message"
                    >
                      <MessageCircle className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleChallengeFriend(friend)}
                      className="p-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-lg transition-all"
                      title="Challenge to game"
                    >
                      <Swords className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="space-y-3">
            {friendRequests.length === 0 ? (
              <div className="text-center py-12">
                <UserPlus className="w-16 h-16 text-white/40 mx-auto mb-4" />
                <p className="text-white/60">No pending friend requests</p>
              </div>
            ) : (
              friendRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between bg-white/5 rounded-lg p-4"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-lg font-bold">
                      {request.username[0].toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">{request.username}</h3>
                      <div className="flex items-center space-x-2 text-sm text-white/60">
                        <span>{request.rating} rating</span>
                        <span>•</span>
                        <span>{getLastSeenText(request.sentAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleAcceptRequest(request.id)}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRejectRequest(request.id)}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'search' && <FriendSearch />}
      </div>

      {/* Challenge Modal */}
      <ChallengeModal
        isOpen={showChallengeModal}
        onClose={() => {
          setShowChallengeModal(false);
          setSelectedFriend(null);
        }}
        friend={selectedFriend}
        onSendChallenge={handleSendChallenge}
      />
    </div>
  );
}

export default Friends;