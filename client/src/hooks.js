import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';

// Query keys don't include the org id: the whole cache is cleared on every org switch.
export const useProjects = (opts = {}) =>
  useQuery({ queryKey: ['projects', Boolean(opts.includeArchived)], queryFn: () => api(`/projects${opts.includeArchived ? '?includeArchived=true' : ''}`), staleTime: 60_000 });

export const useMembers = (enabled = true) =>
  useQuery({ queryKey: ['members'], queryFn: () => api('/org/members'), enabled, staleTime: 60_000 });

export const taskKey = (t) => (t?.project ? `${t.project.key}-${t.number}` : '');
