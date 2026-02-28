import { useEffect, useRef, useState, useCallback } from 'react';

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

function useWebSocket(url, options = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);

  // 1. THE FIX: Store the latest callbacks in a ref
  // This prevents infinite reconnect loops when the parent component re-renders
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  });

  const {
    reconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  // 2. Remove the callbacks from the dependency array here
  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');

      const wsUrl = token
        ? `${WS_BASE_URL}${url}?token=${token}`
        : `${WS_BASE_URL}${url}`;

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = (event) => {
        if (!mountedRef.current) return;
        console.log('WebSocket connected');
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        // Call it via the ref
        callbacksRef.current.onOpen?.(event);
      };

      wsRef.current.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
          // Call it via the ref
          callbacksRef.current.onMessage?.(data);
        } catch (err) {
          console.error('❌ Failed to parse WebSocket message', err);
        }
      };

      wsRef.current.onerror = (event) => {
        if (!mountedRef.current) return;
        console.error('❌ WebSocket error', event);
        setError('WebSocket connection error');
        // Call it via the ref
        callbacksRef.current.onError?.(event);
      };

      wsRef.current.onclose = (event) => {
        if (!mountedRef.current) return;
        console.log('🔌 WebSocket disconnected', event.code, event.reason);
        setIsConnected(false);
        // Call it via the ref
        callbacksRef.current.onClose?.(event);

        if (event.code === 1008 || event.code === 4001) {
          console.error('❌ Authentication failed - stopping reconnection');
          setError('Session expired. Please login again.');
          localStorage.removeItem('access_token');
          localStorage.removeItem('token');
          localStorage.removeItem('refresh');
          localStorage.removeItem('user');
          reconnectAttemptsRef.current = maxReconnectAttempts;
          return;
        }

        if (event.code === 1000) {
          console.log('ℹ️ Clean disconnect - no reconnection needed');
          return;
        }

        if (reconnect && reconnectAttemptsRef.current < maxReconnectAttempts && mountedRef.current) {
          reconnectAttemptsRef.current += 1;

          const backoffDelay = reconnectInterval * Math.pow(1.5, reconnectAttemptsRef.current - 1);

          console.log(
            `Reconnecting in ${backoffDelay / 1000}s (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, backoffDelay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          console.error('❌ Max reconnection attempts reached');
          setError('Unable to connect. Please refresh the page.');
        }
      };
    } catch (err) {
      console.error('❌ Failed to create WebSocket connection', err);
      setError('Failed to connect');
    }
  }, [url, reconnect, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnected');
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      wsRef.current.send(message);
    } else {
      console.error('❌ WebSocket is not connected');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

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
  }, [connect]);

  return {
    isConnected,
    lastMessage,
    error,
    send,
    disconnect,
    reconnect: connect,
  };
}

export default useWebSocket;