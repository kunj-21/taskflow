import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from './api.js';

// Any task event from the server invalidates cached queries so every open tab updates instantly.
export function useRealtime(enabled) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: '/socket.io', auth: (cb) => cb({ token: getAccessToken() }) });
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    };
    ['task:created', 'task:updated', 'task:deleted'].forEach((e) => socket.on(e, refresh));
    return () => socket.disconnect();
  }, [enabled, qc]);
}
