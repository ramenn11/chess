// frontend/src/hooks/useGameApi.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api'; // Assuming your axios/fetch instance is here

// --- QUERIES (Fetching Data) ---

/**
 * Fetches a single game's initial state by ID.
 * Perfect for loading the board before WebSockets take over.
 */
export const useGame = (gameId) => {
    return useQuery({
        queryKey: ['game', gameId],
        queryFn: async () => {
            const { data } = await api.get(`/games/${gameId}`);
            return data;
        },
        enabled: !!gameId, // Only run if gameId exists
        refetchOnWindowFocus: false, // Prevents jarring board resets mid-game
        staleTime: Infinity, // Rely on WebSockets for real-time updates after initial fetch
    });
};

/**
 * Fetches the user's active and past games for the dashboard/profile.
 */
export const useUserGames = (userId) => {
    return useQuery({
        queryKey: ['games', 'user', userId],
        queryFn: async () => {
            const { data } = await api.get(`/games/user/${userId}`);
            return data;
        },
        enabled: !!userId,
    });
};

// --- MUTATIONS (Modifying Data) ---

/**
 * Mutation to create a new game against a bot.
 */
export const useCreateBotGame = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ difficulty, color }) => {
            const { data } = await api.post('/games/bot/create', { difficulty, color });
            return data;
        },
        onSuccess: () => {
            // Invalidate user games so the dashboard updates automatically
            queryClient.invalidateQueries({ queryKey: ['games', 'user'] });
        },
    });
};

/**
 * Mutation to resign from a game.
 */
export const useResignGame = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (gameId) => {
            const { data } = await api.post(`/games/${gameId}/resign`);
            return data;
        },
        onSuccess: (_, gameId) => {
            // Force the specific game query to refresh and show the updated status
            queryClient.invalidateQueries({ queryKey: ['game', gameId] });
        },
    });
};