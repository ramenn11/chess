import { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

function useUserNotifications() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (!user || !token) {
      console.log('No user or token, skipping notification WebSocket');
      return;
    }

    const connectWS = () => {
      if (!mountedRef.current) return;

      try {
        const wsUrl = `${WS_BASE_URL}/ws/notifications/?token=${token}`;
        console.log('Connecting to notification WebSocket...');
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
          console.log('Notification WebSocket connected');
        };

        wsRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('🔔 Notification received:', data);

            if (data.type === 'challenge_accepted') {
              navigate(`/game/${data.game_id}`);
            }
          } catch (err) {
            console.error('Failed to parse notification:', err);
          }
        };

        wsRef.current.onerror = (error) => {
          console.error('Notification WS error:', error);
        };

        wsRef.current.onclose = (event) => {
          console.log('Notification WS closed:', event.code);

          // Don't reconnect on auth failure
          if (event.code === 1008 || event.code === 4001) {
            console.error('Authentication failed for notifications');
            return;
          }

          // Reconnect after 5s
          if (mountedRef.current) {
            reconnectTimeoutRef.current = setTimeout(connectWS, 5000);
          }
        };
      } catch (err) {
        console.error('Failed to create notification WebSocket:', err);
      }
    };

    connectWS();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, [user, token, navigate]);

  return null;
}

export default useUserNotifications;