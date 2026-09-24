import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, EnvelopeSimple, MagnifyingGlass, PaperPlaneTilt, UserMinus, UserPlus, WarningCircle, XCircle } from '@phosphor-icons/react';
import { api } from '../api.js';
import { isAdmin, ROLE_LABEL, useAuth } from '../auth.jsx';
import { Avatar, Modal, Spinner, useDebounced, useToast } from '../components/ui.jsx';

const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];
const ROLE_HELP = {
  OWNER: 'Full control, including billing and deleting the organization',
  ADMIN: 'Manage members, invitations, projects and settings',
  MANAGER: 'See all tasks, assign work and manage projects',
  MEMBER: 'Work on tasks they create or are assigned',
};

// Mirrors the server rules so the UI only offers what will succeed.
const assignableRoles = (myRole) => (myRole === 'OWNER' ? ROLES : ROLES.filter((r) => r !== 'OWNER'));

export default function Team() {
  const { user: me } = useAuth();
  const admin = isAdmin(me);
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState(null);
  const q = useDebounced(search.trim());

  const org = useQuery({ queryKey: ['org'], queryFn: () => api('/org') });
  const members = useQuery({ queryKey: ['members', q], queryFn: () => api(`/org/members${q ? `?search=${encodeURIComponent(q)}` : ''}`), placeholderData: (p) => p });
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: () => api('/org/invitations'), enabled: admin });

  const refresh = () => ['members', 'invitations', 'org'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const setRole = useMutation({
    mutationFn: ({ id, role }) => api(`/org/members/${id}`, { method: 'PATCH', body: { role } }),
    onSuccess: (m) => { refresh(); toast(`${m.name} is now ${ROLE_LABEL[m.role].toLowerCase()}`); },
    onError: (e) => toast(e.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id) => api(`/org/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['tasks'] }); toast(`${removing.name} was removed`); setRemoving(null); },
  });
  const revoke = useMutation({
    mutationFn: (inv) => api(`/org/invitations/${inv.id}`, { method: 'DELETE' }),
    onSuccess: (_d, inv) => { refresh(); toast(`Invitation to ${inv.email} revoked`); },
    onError: (e) => toast(e.message, 'error'),
  });

  const seats = org.data?.seats;
  const seatPct = seats ? Math.min(100, Math.round((seats.used / seats.limit) * 100)) : 0;
  const canEdit = (m) => admin && m.id !== me.id && (m.role !== 'OWNER' || me.role === 'OWNER');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p>{admin ? 'Invite people, set their roles and manage access.' : 'People in this organization.'}</p>
        </div>
        {admin && <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}><UserPlus size={18} weight="bold" /> Invite people</button>}
      </div>

      {seats && (
        <div className="card seat-card">
          <div className="seat-top">
            <div><strong className="num">{seats.used}</strong> of <span className="num">{seats.limit}</span> seats used <span className="muted">· {seats.members} members, {seats.pendingInvites} pending</span></div>
            <span className="badge plan">{org.data.plan.toLowerCase()} plan</span>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={seats.used} aria-valuemin={0} aria-valuemax={seats.limit} aria-label="Seats used">
            <span style={{ width: `${seatPct}%`, background: seatPct >= 100 ? 'var(--danger)' : seatPct >= 80 ? 'var(--warning)' : 'var(--primary)' }} />
          </div>
          {seatPct >= 100 && <p className="stat-sub bad">All seats are in use. Upgrade your plan or revoke pending invitations to add people.</p>}
        </div>
      )}

      <div className="card table-card">
        <div className="table-head">
          <div className="input-wrap" style={{ flex: '1 1 260px', maxWidth: 360 }}>
            <MagnifyingGlass size={18} aria-hidden="true" />
            <input className="input" type="search" placeholder="Search by name or email" aria-label="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ROLES.map((r) => {
              const n = members.data?.filter((m) => m.role === r).length ?? 0;
              return n ? <span key={r} className={`badge role-${r}`}>{n} {ROLE_LABEL[r].toLowerCase()}{n === 1 ? '' : 's'}</span> : null;
            })}
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {members.isLoading && [0, 1, 2].map((i) => <tr key={i}><td colSpan={4}><div className="skeleton" style={{ height: 36 }} /></td></tr>)}
              {members.data?.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="person">
                      <Avatar user={m} className="avatar-lg" />
                      <div><div className="n">{m.name}{m.id === me.id && <span className="muted" style={{ fontWeight: 500 }}> (you)</span>}</div><div className="e">{m.email}</div></div>
                    </div>
                  </td>
                  <td>
                    {canEdit(m) ? (
                      <select className="select" aria-label={`Role for ${m.name}`} value={m.role} disabled={setRole.isPending}
                        onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value })}>
                        {assignableRoles(me.role).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : <span className={`badge role-${m.role}`}>{ROLE_LABEL[m.role]}</span>}
                  </td>
                  <td className="muted num">{new Date(m.joinedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={{ textAlign: 'right' }}>
                    {canEdit(m) && (
                      <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name}`}>
                        <UserMinus size={16} /> Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {members.data?.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 32 }}>No one matches “{search}”.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {admin && invitations.data?.length > 0 && (
        <div className="card table-card" style={{ marginTop: 16 }}>
          <div className="table-head"><h2 className="card-title">Pending invitations</h2></div>
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Invited by</th><th scope="col">Expires</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {invitations.data.map((inv) => (
                  <tr key={inv.id}>
                    <td><span className="person"><EnvelopeSimple size={18} aria-hidden="true" className="muted" />{inv.email}</span></td>
                    <td><span className={`badge role-${inv.role}`}>{ROLE_LABEL[inv.role]}</span></td>
                    <td className="muted">{inv.invitedBy?.name ?? '—'}</td>
                    <td className="muted num">{new Date(inv.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke.mutate(inv)} disabled={revoke.isPending} aria-label={`Revoke invitation to ${inv.email}`}>
                        <XCircle size={16} /> Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {inviting && <InviteModal myRole={me.role} onClose={() => setInviting(false)} onInvited={refresh} />}

      {removing && (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
          <div className="modal-body">
            <p className="muted">They’ll lose access to this organization immediately. Their tasks stay, and anything assigned to them becomes unassigned. They can be invited again later.</p>
            {remove.error && <div className="alert alert-error" role="alert"><WarningCircle size={18} />{remove.error.message}</div>}
          </div>
          <div className="modal-foot">
            <span className="spacer" />
            <button type="button" className="btn btn-secondary" onClick={() => setRemoving(null)} autoFocus>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={() => remove.mutate(removing.id)} disabled={remove.isPending}>
              {remove.isPending ? <Spinner /> : <UserMinus size={18} />} Remove from organization
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function InviteModal({ myRole, onClose, onInvited }) {
  const toast = useToast();
  const [form, setForm] = useState({ email: '', role: 'MEMBER' });
  const [sent, setSent] = useState(null);
  const invite = useMutation({
    mutationFn: () => api('/org/invitations', { method: 'POST', body: form }),
    onSuccess: (res) => { setSent(res); onInvited(); },
  });

  async function copy() {
    try { await navigator.clipboard.writeText(sent.link); toast('Invite link copied'); } catch { toast('Couldn’t copy — select the link and copy it manually', 'error'); }
  }

  return (
    <Modal title={sent ? 'Invitation sent' : 'Invite people'} onClose={onClose}>
      {sent ? (
        <>
          <div className="modal-body">
            <div className="notice"><PaperPlaneTilt size={18} aria-hidden="true" />We emailed an invitation to {sent.invitation.email}. It expires in 7 days.</div>
            <div className="field">
              <label htmlFor="invite-link">Or share this link directly</label>
              <div className="input-wrap">
                <input id="invite-link" className="input" readOnly value={sent.link} onFocus={(e) => e.target.select()} style={{ paddingRight: 44, paddingLeft: 12 }} />
                <button type="button" className="btn btn-ghost btn-icon input-action" onClick={copy} aria-label="Copy invite link"><Copy size={18} /></button>
              </div>
              <span className="hint">Only {sent.invitation.email} can use it.</span>
            </div>
          </div>
          <div className="modal-foot">
            <span className="spacer" />
            <button type="button" className="btn btn-secondary" onClick={() => { setSent(null); setForm({ email: '', role: form.role }); invite.reset(); }}>Invite someone else</button>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
          <div className="modal-body">
            <div className="field">
              <label htmlFor="invite-email">Email address</label>
              <input id="invite-email" className="input" type="email" required autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="colleague@company.com" />
            </div>
            <fieldset className="role-picker">
              <legend className="label">Role</legend>
              {assignableRoles(myRole).map((r) => (
                <label key={r} className={`role-option ${form.role === r ? 'on' : ''}`}>
                  <input type="radio" name="role" value={r} checked={form.role === r} onChange={() => setForm({ ...form, role: r })} />
                  <span><strong>{ROLE_LABEL[r]}</strong><small>{ROLE_HELP[r]}</small></span>
                </label>
              ))}
            </fieldset>
            {invite.error && <div className="alert alert-error" role="alert"><WarningCircle size={18} />{invite.error.message}</div>}
          </div>
          <div className="modal-foot">
            <span className="spacer" />
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={invite.isPending}>{invite.isPending ? <><Spinner /> Sending</> : 'Send invitation'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
