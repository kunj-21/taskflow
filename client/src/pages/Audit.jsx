import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { api, toQuery } from '../api.js';
import { ROLE_LABEL } from '../auth.jsx';
import { Avatar } from '../components/ui.jsx';

const CATEGORIES = [
  { value: '', label: 'All activity' },
  { value: 'member.', label: 'Members' },
  { value: 'invitation.', label: 'Invitations' },
  { value: 'project.', label: 'Projects' },
  { value: 'task.', label: 'Tasks' },
  { value: 'org.', label: 'Organization' },
];

// Human-readable sentence for each audited action.
function describe(e) {
  const m = e.metadata || {};
  const role = (r) => ROLE_LABEL[r]?.toLowerCase() ?? r;
  switch (e.action) {
    case 'org.created': return <>created the organization <b>{m.name}</b></>;
    case 'org.renamed': return <>renamed the organization from <b>{m.from}</b> to <b>{m.to}</b></>;
    case 'member.invited': return <>invited <b>{m.email}</b> as {role(m.role)}</>;
    case 'member.joined': return <>joined as {role(m.role)}</>;
    case 'member.role_changed': return <>changed <b>{m.email}</b> from {role(m.from)} to {role(m.to)}</>;
    case 'member.removed': return <>removed <b>{m.email}</b></>;
    case 'member.left': return <>left the organization</>;
    case 'invitation.revoked': return <>revoked the invitation to <b>{m.email}</b></>;
    case 'project.created': return <>created project <b>{m.name}</b> ({m.key})</>;
    case 'project.archived': return <>archived project <b>{m.name}</b></>;
    case 'project.restored': return <>restored project <b>{m.name}</b></>;
    case 'task.deleted': return <>deleted task <b>{m.key}</b> “{m.title}”</>;
    default: return <>{e.action}</>;
  }
}

export default function Audit() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', action, page], queryFn: () => api(`/org/audit${toQuery({ action, page, limit: 50 })}`), placeholderData: (p) => p });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>A permanent record of who changed access, membership, projects and deletions in this organization.</p>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-head">
          <select className="select" style={{ width: 'auto' }} aria-label="Filter by category" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {q.data && <span className="muted num">{q.data.total} event{q.data.total === 1 ? '' : 's'}</span>}
        </div>
        <ol className="audit-list">
          {q.isLoading && [0, 1, 2, 3].map((i) => <li key={i}><div className="skeleton" style={{ height: 40, width: '100%' }} /></li>)}
          {q.data?.items.map((e) => (
            <li key={e.id}>
              <Avatar user={e.actor} size={32} />
              <div className="audit-body">
                <div><b>{e.actor?.name ?? 'Deleted user'}</b> {describe(e)}</div>
                <div className="audit-meta">
                  <time dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString()}>{new Date(e.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                  {e.ip && <> · IP {e.ip}</>}
                  <> · <code>{e.action}</code></>
                </div>
              </div>
            </li>
          ))}
          {q.data?.items.length === 0 && (
            <li className="empty-col" style={{ margin: 16 }}><ClockCounterClockwise size={28} aria-hidden="true" />No matching events</li>
          )}
        </ol>
      </div>

      {q.data?.totalPages > 1 && (
        <div className="pager">
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
          <span className="muted num">Page {page} of {q.data.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= q.data.totalPages} onClick={() => setPage(page + 1)}>Older</button>
        </div>
      )}
    </>
  );
}
