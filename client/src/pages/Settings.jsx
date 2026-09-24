import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SignOut, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api.js';
import { isAdmin, ROLE_LABEL, useAuth } from '../auth.jsx';
import { Modal, Spinner, useToast } from '../components/ui.jsx';

const PLANS = {
  FREE: { name: 'Free', seats: 'Up to 5 seats', blurb: 'For small teams trying TaskFlow.' },
  PRO: { name: 'Pro', seats: 'Up to 50 seats', blurb: 'For growing teams that need more people and projects.' },
  ENTERPRISE: { name: 'Enterprise', seats: 'Unlimited seats', blurb: 'SSO, advanced audit and dedicated support.' },
};

export default function Settings() {
  const { user, reloadOrgs } = useAuth();
  const admin = isAdmin(user);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const org = useQuery({ queryKey: ['org'], queryFn: () => api('/org') });
  const [name, setName] = useState('');
  const [leaving, setLeaving] = useState(false);

  useEffect(() => { if (org.data) setName(org.data.name); }, [org.data]);

  const rename = useMutation({
    mutationFn: () => api('/org', { method: 'PATCH', body: { name } }),
    onSuccess: async () => { qc.invalidateQueries({ queryKey: ['org'] }); await reloadOrgs(); toast('Organization renamed'); },
  });
  const leave = useMutation({
    mutationFn: () => api(`/org/members/${user.id}`, { method: 'DELETE' }),
    onSuccess: async () => { const list = await reloadOrgs(null); toast(`You left ${org.data.name}`); navigate(list.length ? '/' : '/onboarding', { replace: true }); },
  });

  const o = org.data;
  const plan = o && PLANS[o.plan];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Organization details, plan and your membership.</p>
        </div>
      </div>

      <div className="settings">
        <section className="card settings-section">
          <h2>Organization</h2>
          {!o ? <div className="skeleton" style={{ height: 80 }} /> : (
            <form onSubmit={(e) => { e.preventDefault(); rename.mutate(); }} className="settings-form">
              <div className="field">
                <label htmlFor="org-name">Name</label>
                <input id="org-name" className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!admin} minLength={2} maxLength={80} required />
                {!admin && <span className="hint">Only admins and owners can rename the organization.</span>}
              </div>
              <div className="field">
                <label htmlFor="org-slug">Organization ID</label>
                <input id="org-slug" className="input" value={o.slug} readOnly />
                <span className="hint">Used in support requests and API integrations.</span>
              </div>
              {rename.error && <div className="alert alert-error" role="alert"><WarningCircle size={18} />{rename.error.message}</div>}
              {admin && (
                <div><button type="submit" className="btn btn-primary" disabled={rename.isPending || name.trim() === o.name}>{rename.isPending ? <><Spinner /> Saving</> : 'Save changes'}</button></div>
              )}
            </form>
          )}
        </section>

        <section className="card settings-section">
          <h2>Plan &amp; seats</h2>
          {o && (
            <>
              <div className="plan-row">
                <div>
                  <div className="plan-name">{plan.name} <span className="badge plan">{plan.seats}</span></div>
                  <p className="muted">{plan.blurb}</p>
                </div>
                <div className="plan-usage num"><strong>{o.seats.used}</strong> / {o.seats.limit} seats</div>
              </div>
              <p className="hint">Billing and plan upgrades are coming soon. Contact support to change your plan.</p>
            </>
          )}
        </section>

        <section className="card settings-section">
          <h2>Your membership</h2>
          <p className="muted">Your role in {o?.name}: <span className={`badge role-${user.role}`}>{ROLE_LABEL[user.role]}</span></p>
          <div><button type="button" className="btn btn-danger-ghost" onClick={() => setLeaving(true)}><SignOut size={18} /> Leave organization</button></div>
        </section>
      </div>

      {leaving && (
        <Modal title={`Leave ${o?.name}?`} onClose={() => setLeaving(false)}>
          <div className="modal-body">
            <p className="muted">You’ll lose access right away. Tasks you created stay with the organization. To come back, an admin will need to invite you again.</p>
            {leave.error && <div className="alert alert-error" role="alert"><WarningCircle size={18} />{leave.error.message}</div>}
          </div>
          <div className="modal-foot">
            <span className="spacer" />
            <button type="button" className="btn btn-secondary" onClick={() => setLeaving(false)} autoFocus>Stay</button>
            <button type="button" className="btn btn-danger" onClick={() => leave.mutate()} disabled={leave.isPending}>{leave.isPending ? <Spinner /> : 'Leave organization'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
