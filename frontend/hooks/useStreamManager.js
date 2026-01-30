// hooks/useStreamManager.js
// Frontend stream management hook with auto-reconnection

import { useEffect, useRef, useCallback } from 'react';

export const useStreamManager = (conversationId, onMessage, enabled = true) => {
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000;

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      console.log('🔌 Closing SSE connection');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!conversationId) return;
    if (!enabled) return;

    cleanup();

    const API_BASE = import.meta.env.VITE_API_BASE || "https://sanch-ai.vercel.app";
    console.log(`🔗 Connecting SSE: ${conversationId} | URL: ${API_BASE}/api/stream/${conversationId}`);
    
    const eventSource = new EventSource(`${API_BASE}/api/stream/${conversationId}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('✅ SSE Connected');
      reconnectAttemptsRef.current = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error('❌ SSE parse error:', e);
      }
    };

    eventSource.onerror = (error) => {
      console.error('❌ SSE error:', error);
      cleanup();

      // Exponential backoff with max attempts
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(
          baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current),
          30000 // Max 30 seconds
        );
        
        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connect();
        }, delay);
      } else {
        console.error('❌ Max reconnection attempts reached. Please refresh the page.');
        // Notify user
        if (onMessage) {
          onMessage({
            type: 'error',
            message: 'Connection lost. Please refresh the page to reconnect.'
          });
        }
      }
    };
  }, [conversationId, enabled, onMessage, cleanup]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  return {
    reconnect: connect,
    disconnect: cleanup,
    isConnected: () => eventSourceRef.current?.readyState === EventSource.OPEN
  };
};
