import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { ArrowsClockwise, Bell, EnvelopeSimple, Eye, EyeSlash, Lightning, LockSimple, ShieldCheck, User, WarningCircle } from '@phosphor-icons/react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Logo } from '../components/Layout.jsx';
import { Spinner } from '../components/ui.jsx';

const DEMO = [
  { label: 'Admin', email: 'admin@taskflow.dev' },
  { label: 'Manager', email: 'manager@taskflow.dev' },
  { label: 'Member', email: 'member@taskflow.dev' },
];

// Official multi-color Google "G" mark.
const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export default function Login() {
  const { user, login, register } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(params.get('error') ? 'Google sign-in didn’t complete. Please try again.' : '');
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);

  useEffect(() => { api('/auth/providers').then((p) => setGoogle(p.google)).catch(() => {}); }, []);

  if (user) return <Navigate to="/" replace />;

  const isLogin = mode === 'login';
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isLogin) await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
    } catch (err) {
      setError(err.details ? Object.entries(err.details).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join(' · ') : err.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth-brand" aria-hidden="true">
        <Logo />
        <div>
          <h1>Plan, assign and ship — together.</h1>
          <p className="lead">TaskFlow keeps your team’s work in one live board, so everyone knows what’s next.</p>
          <ul className="features">
            <li><span className="fi"><Lightning size={18} weight="fill" /></span>Real-time updates across every device</li>
            <li><span className="fi"><ShieldCheck size={18} weight="fill" /></span>Role-based access for admins, managers and members</li>
            <li><span className="fi"><Bell size={18} weight="fill" /></span>Automatic due-date reminders and weekly reports</li>
          </ul>
        </div>
        <div className="preview">
          <div className="pv"><ArrowsClockwise size={16} weight="bold" />Set up CI pipeline<span className="badge">In progress</span></div>
          <div className="pv"><ShieldCheck size={16} weight="bold" />Review Q3 roadmap<span className="badge">In review</span></div>
        </div>
      </section>

      <main className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div>
            <h2>{isLogin ? 'Welcome back' : 'Create your account'}</h2>
            <p className="muted" style={{ marginTop: 6 }}>{isLogin ? 'Sign in to your workspace to continue.' : 'Start organizing your team’s work in minutes.'}</p>
          </div>

          {google && (
            <>
              <a className="btn btn-secondary btn-block" href="/api/v1/auth/google"><GoogleG />Continue with Google</a>
              <div className="divider">or with email</div>
            </>
          )}

          {!isLogin && (
            <div className="field">
              <label htmlFor="name">Full name</label>
              <div className="input-wrap">
                <User size={18} aria-hidden="true" />
                <input id="name" className="input" autoComplete="name" value={form.name} onChange={set('name')} required />
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email</label>
            <div className="input-wrap">
              <EnvelopeSimple size={18} aria-hidden="true" />
              <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set('email')} placeholder="you@company.com" required />
            </div>
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input-wrap">
              <LockSimple size={18} aria-hidden="true" />
              <input id="password" className="input" type={showPw ? 'text' : 'password'} autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={form.password} onChange={set('password')} required minLength={isLogin ? 1 : 8} style={{ paddingRight: 44 }}
                aria-describedby={!isLogin ? 'pw-hint' : undefined} />
              <button type="button" className="btn btn-ghost btn-icon input-action" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}>
                {showPw ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {!isLogin && <span id="pw-hint" className="hint">At least 8 characters.</span>}
          </div>

          {error && <div className="alert alert-error" role="alert"><WarningCircle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />{error}</div>}

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <><Spinner /> {isLogin ? 'Signing in' : 'Creating account'}</> : isLogin ? 'Sign in' : 'Create account'}
          </button>

          <p className="switch-mode">
            {isLogin ? 'New to TaskFlow?' : 'Already have an account?'}
            <button type="button" className="link-btn" onClick={() => { setMode(isLogin ? 'register' : 'login'); setError(''); }}>
              {isLogin ? 'Create an account' : 'Sign in'}
            </button>
          </p>

          {isLogin && (
            <div className="demo">
              <strong>Try a demo account</strong> — password <code>password123</code>
              <div className="demo-list">
                {DEMO.map((d) => (
                  <button key={d.email} type="button" onClick={() => setForm({ ...form, email: d.email, password: 'password123' })}>{d.label}</button>
                ))}
              </div>
            </div>
          )}
        </form>
      </main>
    </div>
  );
}
