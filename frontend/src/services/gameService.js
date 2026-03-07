import api from './api';

class GameService {
  async createGame(opponentId, timeControl) {
    try {
      const response = await api.post('/game/create/', {
        opponent_id: opponentId,
        time_control: timeControl,
      });
      return { success: true, game: response };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getGame(gameId) {
    try {
      const response = await api.get(`/game/games/${gameId}/`);
      return { success: true, game: response };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getGameMoves(gameId) {
    try {
      const response = await api.get(`/game/games/${gameId}/moves/`);
      return { success: true, moves: response };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getUserGames(username, params = {}) {
    try {
      const response = await api.get(`/game/user-games/${username}/`, { params });
      return { success: true, games: response };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getOngoingGames(params = {}) {
    try {
      const response = await api.get('/game/games/', {
        params: { status: 'ongoing', ...params }
      });
      return { success: true, games: response };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export default new GameService();