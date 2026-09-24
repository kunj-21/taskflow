import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setOrgId } from './api.js';

const AuthContext = createContext(null);
const ORG_KEY = 'tf-org';

const readSavedOrg = () => { try { return localStorage.getItem(ORG_KEY); } catch { return null; } };
const saveOrg = (id) => { try { if (id) localStorage.setItem(ORG_KEY, id); else localStorage.removeItem(ORG_KEY); } catch { /* storage unavailable */ } };

// Pick the saved org if the user still belongs to it, else their first org.
const chooseOrg = (orgs, preferred) => orgs.find((o) => o.id === preferred)?.id ?? orgs[0]?.id ?? null;

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [account, setAccount] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [orgId, setCurrentOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  // setOrgId must run before any query fires for the new org, so it happens synchronously here.
  const applyOrgs = useCallback((list, preferred = readSavedOrg()) => {
    const id = chooseOrg(list, preferred);
    setOrgId(id);
    saveOrg(id);
    setOrgs(list);
    setCurrentOrg(id);
  }, []);

  // On load, try to resume a session from the httpOnly refresh cookie.
  useEffect(() => {
    refreshSession()
      .then((s) => { applyOrgs(s.organizations); setAccount(s.user); })
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, [applyOrgs]);

  // Cached queries belong to one user in one org; drop them whenever either changes.
  const startSession = useCallback((s, preferredOrg) => {
    queryClient.clear();
    setAccessToken(s.accessToken);
    applyOrgs(s.organizations, preferredOrg);
    setAccount(s.user);
    return s;
  }, [queryClient, applyOrgs]);

  const login = useCallback(async (email, password) => startSession(await api('/auth/login', { method: 'POST', body: { email, password }, org: false })), [startSession]);

  // payload: { name, email, password, orgName } or { name, email, password, inviteToken }
  const register = useCallback(async (payload) => {
    const s = await api('/auth/register', { method: 'POST', body: payload, org: false });
    return startSession(s, s.organizations.at(-1)?.id);
  }, [startSession]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', org: false }).catch(() => {});
    setAccessToken(null);
    setOrgId(null);
    setAccount(null);
    setOrgs([]);
    setCurrentOrg(null);
    queryClient.clear();
  }, [queryClient]);

  const resume = useCallback(async () => {
    const s = await refreshSession();
    applyOrgs(s.organizations);
    setAccount(s.user);
  }, [applyOrgs]);

  const switchOrg = useCallback((id) => {
    if (id === orgId) return;
    queryClient.clear();
    setOrgId(id);
    saveOrg(id);
    setCurrentOrg(id);
  }, [orgId, queryClient]);

  // Re-fetch the org list (after creating, joining or leaving an org, or a role change).
  const reloadOrgs = useCallback(async (preferred) => {
    const list = await api('/orgs', { org: false });
    queryClient.clear();
    applyOrgs(list, preferred ?? orgId);
    return list;
  }, [applyOrgs, orgId, queryClient]);

  const org = orgs.find((o) => o.id === orgId) || null;
  // `user.role` is the role in the current org, so components can ask canManage(user).
  const user = useMemo(() => (account ? { ...account, role: org?.role ?? null } : null), [account, org?.role]);

  const value = { user, orgs, org, loading, login, register, logout, resume, switchOrg, reloadOrgs };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

const RANK = { MEMBER: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };
export const roleAtLeast = (role, min) => (RANK[role] || 0) >= RANK[min];
export const canManage = (user) => roleAtLeast(user?.role, 'MANAGER');
export const isAdmin = (user) => roleAtLeast(user?.role, 'ADMIN');
export const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', MEMBER: 'Member' };
