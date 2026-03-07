import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Clock, Users, TrendingUp, Filter, Search } from 'lucide-react';
import api from '../services/api';

function Spectate() {
  const [liveGames, setLiveGames] = useState([]);
  const [filter, setFilter] = useState('all'); // all, rated, casual
  const [sortBy, setSortBy] = useState('viewers'); // viewers, rating
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchLiveGames();

    // Poll for updates every 10 seconds
    const interval = setInterval(fetchLiveGames, 10000);
    return () => clearInterval(interval);
  }, [filter, sortBy]);

  const fetchLiveGames = async () => {
    try {
      // Hits the new Redis-enriched endpoint
      const response = await api.get('/game/games/live/lobby/');
      setLiveGames(response.data);
    } catch (error) {
      console.error('Failed to fetch live games:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const filteredGames = liveGames
    .filter(game => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          game.white_player.username.toLowerCase().includes(query) ||
          game.black_player.username.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'viewers') {
        return b.spectators - a.spectators;
      } else if (sortBy === 'rating') {
        const avgA = (a.white_player.rating + a.black_player.rating) / 2;
        const avgB = (b.white_player.rating + b.black_player.rating) / 2;
        return avgB - avgA;
      }
      return 0;
    });

  return (
    <div className="container mx-auto max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Watch Live Games</h1>
        <p className="text-white/60">Learn from top players and exciting matches</p>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/60 text-sm mb-1">Live Games</p>
              <p className="text-3xl font-bold text-white">{liveGames.length}</p>
            </div>
            <Eye className="w-8 h-8 text-purple-400" />
          </div>
        </div>
        <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/60 text-sm mb-1">Total Spectators</p>
              <p className="text-3xl font-bold text-white">
                {liveGames.reduce((sum, game) => sum + game.spectators, 0).toLocaleString()}
              </p>
            </div>
            <Users className="w-8 h-8 text-blue-400" />
          </div>
        </div>
        <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/60 text-sm mb-1">Top Rating</p>
              <p className="text-3xl font-bold text-white">
                {Math.max(...liveGames.flatMap(g => [g.white_player.rating, g.black_player.rating]))}
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-yellow-400" />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 mb-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/40 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by player name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-lg pl-10 pr-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {/* Sort */}
        <div className="flex items-center space-x-2 bg-white/10 border border-white/20 rounded-lg p-1">
          <button
            onClick={() => setSortBy('viewers')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${sortBy === 'viewers'
                ? 'bg-purple-600 text-white'
                : 'text-white/60 hover:text-white'
              }`}
          >
            Most Viewed
          </button>
          <button
            onClick={() => setSortBy('rating')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${sortBy === 'rating'
                ? 'bg-purple-600 text-white'
                : 'text-white/60 hover:text-white'
              }`}
          >
            Top Rated
          </button>
        </div>
      </div>

      {/* Games Grid */}
      {loading ? (
        <div className="text-center text-white py-12">Loading live games...</div>
      ) : filteredGames.length === 0 ? (
        <div className="bg-white/5 backdrop-blur-lg rounded-xl border border-white/10 p-12 text-center">
          <Eye className="w-16 h-16 text-white/40 mx-auto mb-4" />
          <p className="text-white/60 text-lg">No live games at the moment</p>
          <p className="text-white/40 text-sm mt-2">Check back soon for exciting matches!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredGames.map((game) => (
            <div
              key={game.game_id}
              onClick={() => navigate(`/game/${game.game_id}`)}
              className="group bg-white/5 hover:bg-white/10 backdrop-blur-lg rounded-xl border border-white/10 hover:border-purple-500/50 overflow-hidden transition-all cursor-pointer hover:scale-[1.02]"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-purple-600/20 to-pink-600/20 border-b border-white/10 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-4 h-4 text-white/60" />
                    <span className="text-white/80 text-sm">{game.time_control}</span>
                  </div>
                  <div className="flex items-center space-x-2 bg-white/10 px-3 py-1 rounded-full">
                    <Eye className="w-4 h-4 text-purple-400" />
                    <span className="text-white font-semibold text-sm">
                      {game.spectators.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="text-white/60 text-sm">Move {game.move_count}</div>
              </div>

              {/* Players */}
              <div className="p-6 space-y-4">
                {/* White Player */}
                <div className="flex items-center justify-between bg-white/5 rounded-lg p-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-gray-900 font-bold">
                      ♔
                    </div>
                    <div>
                      <p className="text-white font-semibold">{game.white_player.username}</p>
                      <p className="text-white/60 text-sm">{game.white_player.rating}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-mono text-lg">{formatTime(game.white_time_left)}</p>
                    <p className="text-white/60 text-xs">Time Left</p>
                  </div>
                </div>

                {/* VS Divider */}
                <div className="text-center">
                  <span className="text-white/40 font-semibold">VS</span>
                </div>

                {/* Black Player */}
                <div className="flex items-center justify-between bg-white/5 rounded-lg p-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-900 rounded-full flex items-center justify-center text-white font-bold">
                      ♚
                    </div>
                    <div>
                      <p className="text-white font-semibold">{game.black_player.username}</p>
                      <p className="text-white/60 text-sm">{game.black_player.rating}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-mono text-lg">{formatTime(game.black_time_left)}</p>
                    <p className="text-white/60 text-xs">Time Left</p>
                  </div>
                </div>
              </div>

              {/* Watch Button */}
              <div className="p-4 border-t border-white/10">
                <button className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg py-3 font-semibold transition-all group-hover:scale-105">
                  Watch Game
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Spectate;