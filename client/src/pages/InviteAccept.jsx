import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EnvelopeSimple, SignOut, UsersThree, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api.js';
import { ROLE_LABEL, useAuth } from '../auth.jsx';
import { Logo } from '../components/Layout.jsx';
import { Spinner } from '../components/ui.jsx';

export default function InviteAccept() {
  const { token } = useParams();
  const { user, loading, reloadOrgs, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api(`/invitations/${token}`, { org: false }), retry: false });

  async function accept() {
    setBusy(true);
    setError('');
    try {
      const org = await api(`/invitations/${token}/accept`, { method: 'POST', org: false });
      await reloadOrgs(org.id);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const inv = invite.data;
  const emailMatches = user && inv && user.email.toLowerCase() === inv.email.toLowerCase();
  const signupHref = inv && `/login?mode=register&invite=${encodeURIComponent(token)}&email=${encodeURIComponent(inv.email)}`;
  const loginHref = inv && `/login?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(inv.email)}`;

  return (
    <div className="onboard">
      <div className="onboard-card card">
        <Logo />
        {(invite.isLoading || loading) && <div className="center-inline"><Spinner /> Checking your invitation…</div>}

        {invite.error && (
          <>
            <div className="onboard-icon danger" aria-hidden="true"><WarningCircle size={28} weight="duotone" /></div>
            <h1>Invitation unavailable</h1>
            <p className="muted">{invite.error.message}</p>
            <Link className="btn btn-secondary" to="/">Go to TaskFlow</Link>
          </>
        )}

        {inv && !loading && (
          <>
            <div className="onboard-icon" aria-hidden="true"><UsersThree size={28} weight="duotone" /></div>
            <h1>Join {inv.org.name}</h1>
            <p className="muted">
              {inv.invitedBy ? `${inv.invitedBy} invited you` : 'You’ve been invited'} to join <strong>{inv.org.name}</strong> as {ROLE_LABEL[inv.role].toLowerCase()}.
            </p>
            <div className="invite-to"><EnvelopeSimple size={18} aria-hidden="true" />{inv.email}</div>

            {error && <div className="alert alert-error" role="alert"><WarningCircle size={18} />{error}</div>}

            {!user && (
              <>
                <Link className="btn btn-primary btn-block" to={signupHref}>Create account &amp; join</Link>
                <Link className="btn btn-secondary btn-block" to={loginHref}>I already have an account</Link>
              </>
            )}
            {user && emailMatches && (
              <button type="button" className="btn btn-primary btn-block" onClick={accept} disabled={busy}>
                {busy ? <><Spinner /> Joining</> : `Accept and join ${inv.org.name}`}
              </button>
            )}
            {user && !emailMatches && (
              <>
                <div className="alert alert-error" role="alert"><WarningCircle size={18} />You’re signed in as {user.email}, but this invitation is for {inv.email}.</div>
                <button type="button" className="btn btn-secondary btn-block" onClick={logout}><SignOut size={18} /> Sign out and switch account</button>
              </>
            )}
            <p className="hint">Expires {new Date(inv.expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.</p>
          </>
        )}
      </div>
    </div>
  );
}
