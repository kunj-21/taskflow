import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

export default function Login() {
  const { user, login, register } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(params.get('error') ? 'Google sign-in failed' : '');
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);

  useEffect(() => { api('/auth/providers').then((p) => setGoogle(p.google)).catch(() => {}); }, []);

  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
    } catch (err) {
      setError(err.details ? Object.values(err.details).flat().join(', ') : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>TaskFlow</h1>
        <p className="muted">{mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}</p>

        {mode === 'register' && <input placeholder="Name" value={form.name} onChange={set('name')} required />}
        <input type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
        <input type="password" placeholder="Password" value={form.password} onChange={set('password')} required minLength={mode === 'register' ? 8 : 1} />
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>

        {google && (
          <>
            <div className="divider">or</div>
            <a className="button secondary" href="/api/v1/auth/google">Continue with Google</a>
          </>
        )}

        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
        <p className="muted small">Demo: admin@taskflow.dev / password123</p>
      </form>
    </div>
  );
}
