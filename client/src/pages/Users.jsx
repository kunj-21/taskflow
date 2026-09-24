import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MagnifyingGlass, UserMinus, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Avatar, Modal, Spinner, useDebounced, useToast } from '../components/ui.jsx';

const ROLES = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'MEMBER', label: 'Member' },
];

export default function Users() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState(null);
  const q = useDebounced(search.trim());

  const users = useQuery({ queryKey: ['users', q], queryFn: () => api(`/users${q ? `?search=${encodeURIComponent(q)}` : ''}`), placeholderData: (p) => p });

  const setRole = useMutation({
    mutationFn: ({ id, role }) => api(`/users/${id}/role`, { method: 'PATCH', body: { role } }),
    onSuccess: (u) => { qc.invalidateQueries({ queryKey: ['users'] }); toast(`${u.name} is now ${u.role.toLowerCase()}`); },
    onError: (e) => toast(e.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries(); toast(`${removing.name} removed`); setRemoving(null); },
  });

  const counts = ROLES.map((r) => ({ ...r, n: users.data?.filter((u) => u.role === r.value).length ?? 0 }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p>Manage who can assign work and administer the workspace.</p>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <div className="input-wrap" style={{ flex: '1 1 260px', maxWidth: 360 }}>
            <MagnifyingGlass size={18} aria-hidden="true" />
            <input className="input" type="search" placeholder="Search by name or email" aria-label="Search team members" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {counts.map((c) => <span key={c.value} className={`badge role-${c.value}`}>{c.n} {c.label.toLowerCase()}{c.n === 1 ? '' : 's'}</span>)}
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {users.isLoading && [0, 1, 2].map((i) => (
                <tr key={i}><td colSpan={4}><div className="skeleton" style={{ height: 36 }} /></td></tr>
              ))}
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="person">
                      <Avatar user={u} className="avatar-lg" />
                      <div><div className="n">{u.name}{u.id === me.id && <span className="muted" style={{ fontWeight: 500 }}> (you)</span>}</div><div className="e">{u.email}</div></div>
                    </div>
                  </td>
                  <td>
                    <select className="select" aria-label={`Role for ${u.name}`} value={u.role} disabled={u.id === me.id || setRole.isPending}
                      onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })}>
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                  <td className="muted num">{new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={{ textAlign: 'right' }}>
                    {u.id !== me.id && (
                      <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setRemoving(u)} aria-label={`Remove ${u.name}`}>
                        <UserMinus size={16} /> Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.data?.length === 0 && (
                <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 32 }}>No one matches “{search}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {removing && (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
          <div className="modal-body">
            <p className="muted">They’ll lose access immediately. Tasks they created will be deleted and tasks assigned to them will become unassigned. This can’t be undone.</p>
            {remove.error && <div className="alert alert-error" role="alert"><WarningCircle size={18} />{remove.error.message}</div>}
          </div>
          <div className="modal-foot">
            <span className="spacer" />
            <button type="button" className="btn btn-secondary" onClick={() => setRemoving(null)} autoFocus>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={() => remove.mutate(removing.id)} disabled={remove.isPending}>
              {remove.isPending ? <Spinner /> : <UserMinus size={18} />} Remove member
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
