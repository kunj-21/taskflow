import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, refreshSession, setAccessToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On load, try to resume a session from the httpOnly refresh cookie.
  useEffect(() => {
    refreshSession()
      .then((s) => setUser(s.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const startSession = useCallback((s) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
  }, []);

  const login = useCallback(async (email, password) => startSession(await api('/auth/login', { method: 'POST', body: { email, password } })), [startSession]);
  const register = useCallback(async (name, email, password) => startSession(await api('/auth/register', { method: 'POST', body: { name, email, password } })), [startSession]);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setAccessToken(null);
    setUser(null);
  }, []);
  const resume = useCallback(async () => setUser((await refreshSession()).user), []);

  return <AuthContext.Provider value={{ user, loading, login, register, logout, resume }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
export const canManage = (user) => user?.role === 'ADMIN' || user?.role === 'MANAGER';
