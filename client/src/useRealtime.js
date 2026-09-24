import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from './api.js';

// One socket per (user, org). Any task event invalidates cached queries so open tabs update instantly.
export function useRealtime(orgId) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!orgId) return undefined;
    const socket = io({ path: '/socket.io', auth: (cb) => cb({ token: getAccessToken(), orgId }) });
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    };
    ['task:created', 'task:updated', 'task:deleted'].forEach((e) => socket.on(e, refresh));
    return () => socket.disconnect();
  }, [orgId, qc]);
}
