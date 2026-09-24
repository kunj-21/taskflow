import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Buildings, EnvelopeSimpleOpen, SignOut, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components/Layout.jsx';
import { Spinner } from '../components/ui.jsx';

// Shown to signed-in users with no organization (e.g. new Google sign-ups, or after leaving
// their last org), and from the org switcher's "Create organization".
export default function Onboarding() {
  const { user, orgs, reloadOrgs, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) return <Navigate to="/login" replace />;
  const creatingAnother = params.get('new') === '1' && orgs.length > 0;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const org = await api('/orgs', { method: 'POST', body: { name }, org: false });
      await reloadOrgs(org.id);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.details ? Object.values(err.details).flat().join(', ') : err.message);
      setBusy(false);
    }
  }

  return (
    <div className="onboard">
      <div className="onboard-card card">
        <Logo />
        <div className="onboard-icon" aria-hidden="true"><Buildings size={28} weight="duotone" /></div>
        <h1>{creatingAnother ? 'Create another organization' : `Welcome, ${user.name.split(' ')[0]}`}</h1>
        <p className="muted">
          {creatingAnother
            ? 'Each organization has its own members, projects and billing.'
            : 'Create an organization for your company. You’ll be its owner and can invite your team next.'}
        </p>
        <form onSubmit={submit} className="onboard-form">
          <div className="field">
            <label htmlFor="org-name">Organization name</label>
            <input id="org-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp" required minLength={2} maxLength={80} autoFocus />
          </div>
          {error && <div className="alert alert-error" role="alert"><WarningCircle size={18} />{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || name.trim().length < 2}>
            {busy ? <><Spinner /> Creating</> : 'Create organization'}
          </button>
        </form>
        {creatingAnother ? (
          <button type="button" className="link-btn" onClick={() => navigate(-1)}>Cancel</button>
        ) : (
          <>
            <div className="notice"><EnvelopeSimpleOpen size={18} aria-hidden="true" />Joining a team instead? Open the invitation link from your email.</div>
            <button type="button" className="btn btn-ghost" onClick={logout}><SignOut size={18} /> Sign out ({user.email})</button>
          </>
        )}
      </div>
    </div>
  );
}
