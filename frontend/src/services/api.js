const API_BASE_URL = `${import.meta.env.VITE_API_URL.trim()}/api`;

class ApiService {
    constructor() {
        this.baseUrl = API_BASE_URL;
        this.isRefreshing = false;
        this.failedQueue = [];
    }

    getHeaders(includeAuth = true) {
        const headers = {
            'Content-Type': 'application/json',
        }

        if (includeAuth) {
            const token = localStorage.getItem('token');
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }

        return headers;
    }

    processQueue(error, token = null) {
        this.failedQueue.forEach(prom => {
            if (error) {
                prom.reject(error);
            } else {
                prom.resolve(token);
            }
        });
        this.failedQueue = [];
    }

    async refreshToken() {
        const refresh = localStorage.getItem('refresh');
        if (!refresh) {
            throw new Error('No refresh token');
        }

        const response = await fetch(`${this.baseUrl}/auth/token/refresh/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh }),
        });

        if (!response.ok) {
            throw new Error('Refresh failed');
        }

        const data = await response.json();
        localStorage.setItem('token', data.access);
        return data.access;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            ...options,
            headers: {
                ...this.getHeaders(options.auth !== false),
                ...options.headers,
            },
        };

        try {
            const response = await fetch(url, config);

            if (response.status === 401 && options.auth !== false) {
                if (endpoint === '/auth/token/refresh/') {
                    localStorage.clear();
                    window.location.href = '/login';
                    throw new Error('Session expired');
                }

                if (this.isRefreshing) {
                    return new Promise((resolve, reject) => {
                        this.failedQueue.push({ resolve, reject });
                    })
                        .then(token => {
                            config.headers['Authorization'] = `Bearer ${token}`;
                            return fetch(url, config).then(res => res.json());
                        })
                        .catch(err => {
                            throw err;
                        });
                }

                this.isRefreshing = true;

                try {
                    const newToken = await this.refreshToken();
                    this.isRefreshing = false;
                    this.processQueue(null, newToken);

                    config.headers['Authorization'] = `Bearer ${newToken}`;
                    const retryResponse = await fetch(url, config);

                    if (!retryResponse.ok) {
                        const error = await retryResponse.json();
                        throw new Error(error.message || 'Request failed');
                    }

                    return await retryResponse.json();
                } catch (refreshError) {
                    this.isRefreshing = false;
                    this.processQueue(refreshError, null);

                    localStorage.clear();
                    window.location.href = '/login';
                    throw new Error('Session expired');
                }
            }

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || error.error || 'Request failed');
            }

            return await response.json();
        } catch (error) {
            console.error('API Request failed:', error);
            throw error;
        }
    }

    async get(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: 'GET' });
    }

    async post(endpoint, data, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async patch(endpoint, data, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async put(endpoint, data, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async delete(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: "DELETE" });
    }

    // AUTH METHODS
    async register(userData) {
        return this.post('/auth/register/', userData, { auth: false });
    }

    async login(email, password) {
        return this.post('/auth/login/', { email, password }, { auth: false });
    }

    async googleAuth(token) {
        return this.post('/auth/google/', { token }, { auth: false });
    }

    async logout(refreshToken) {
        return this.post('/auth/logout/', { refresh: refreshToken });
    }

    async getCurrentUser() {
        return this.get('/auth/me/');
    }

    async updateProfile(data) {
        return this.put('/auth/profile/update/', data);
    }

    async changePassword(oldPassword, newPassword) {
        return this.post('/auth/password/change/', {
            old_password: oldPassword,
            new_password: newPassword
        });
    }

    async getUserProfile(username) {
        return this.get(`/auth/users/${username}/`, { auth: false });
    }

    // FRIENDS METHODS
    async getFriends() {
        return this.get('/auth/friends/');
    }

    async getFriendRequests() {
        return this.get('/auth/friends/requests/');
    }

    async sendFriendRequest(username) {
        return this.post('/auth/friends/request/', { username });
    }

    async acceptFriendRequest(requestId) {
        return this.post('/auth/friends/accept/', { request_id: requestId });
    }

    async rejectFriendRequest(requestId) {
        return this.post('/auth/friends/reject/', { request_id: requestId });
    }

    async removeFriend(userId) {
        return this.delete(`/auth/friends/${userId}/`);
    }

    async searchUsers(query) {
        return this.get(`/auth/users/search/?q=${encodeURIComponent(query)}`);
    }

    // GAME METHODS
    async listGames(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.get(`/game/games/${queryString ? `?${queryString}` : ''}`);
    }

    async getGame(gameId) {
        return this.get(`/game/games/${gameId}/`);
    }

    async getGameMoves(gameId) {
        return this.get(`/game/games/${gameId}/moves/`);
    }

    async getUserGames(username) {
        return this.get(`/game/user-games/${username}/`);
    }

    // CHALLENGE METHODS
    async sendChallenge(friendId, timeControl) {
        return this.post('/game/challenges/send/', {
            friend_id: friendId,
            time_control: timeControl
        });
    }

    async getPendingChallenges() {
        return this.get('/game/challenges/pending/');
    }

    async acceptChallenge(challengeId) {
        return this.post(`/game/challenges/accept/${challengeId}/`);
    }

    async rejectChallenge(challengeId) {
        return this.post(`/game/challenges/reject/${challengeId}/`);
    }

    async cancelChallenge(challengeId) {
        return this.post(`/game/challenges/${challengeId}/cancel/`);
    }

    // UTILITY METHODS
    async uploadFile(endpoint, file, additionalData = {}) {
        const formData = new FormData();
        formData.append('file', file);

        Object.keys(additionalData).forEach(key => {
            formData.append(key, additionalData[key]);
        });

        const url = `${this.baseUrl}${endpoint}`;
        const token = localStorage.getItem('token');

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Upload failed');
        }

        return await response.json();
    }

    // HELPER METHODS
    isAuthenticated() {
        return !!localStorage.getItem('token');
    }

    getToken() {
        return localStorage.getItem('token');
    }

    clearAuth() {
        localStorage.removeItem('token');
        localStorage.removeItem('refresh');
        localStorage.removeItem('user');
    }
}

export const api = new ApiService();
export default api;
