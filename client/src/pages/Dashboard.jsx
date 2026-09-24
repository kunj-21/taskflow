import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery } from '../api.js';
import { canManage, useAuth } from '../auth.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { PRIORITIES, STATUSES } from '../constants.js';

const label = (s) => s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ search: '', priority: '', assigneeId: '', sortBy: 'dueDate', order: 'asc' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | task

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api('/tasks/stats') });
  const tasks = useQuery({
    queryKey: ['tasks', filters, page],
    queryFn: () => api(`/tasks${toQuery({ ...filters, page, limit: 50 })}`),
    placeholderData: (prev) => prev,
  });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users'), enabled: canManage(user) });

  const move = useMutation({
    mutationFn: ({ id, status }) => api(`/tasks/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['stats'] }); },
  });

  const setFilter = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };
  const s = stats.data;
  const total = s ? Object.values(s.byStatus).reduce((a, b) => a + b, 0) : 0;
  const done = s?.byStatus.DONE || 0;

  return (
    <div className="dashboard">
      <section className="stats">
        <Stat title="Total tasks" value={total} />
        <Stat title="Completed" value={total ? `${Math.round((done / total) * 100)}%` : '—'} sub={`${done} done`} />
        <Stat title="Due this week" value={s?.dueThisWeek ?? '—'} />
        <Stat title="Overdue" value={s?.overdue ?? '—'} tone={s?.overdue ? 'danger' : undefined} />
      </section>

      <section className="toolbar">
        <input placeholder="Search tasks…" value={filters.search} onChange={setFilter('search')} />
        <select value={filters.priority} onChange={setFilter('priority')}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}
        </select>
        <select value={filters.assigneeId} onChange={setFilter('assigneeId')}>
          <option value="">{canManage(user) ? 'Everyone' : 'All my tasks'}</option>
          <option value="me">Assigned to me</option>
          {users.data?.filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={`${filters.sortBy}:${filters.order}`} onChange={(e) => { const [sortBy, order] = e.target.value.split(':'); setFilters({ ...filters, sortBy, order }); }}>
          <option value="dueDate:asc">Due soonest</option>
          <option value="priority:desc">Highest priority</option>
          <option value="createdAt:desc">Newest</option>
          <option value="updatedAt:desc">Recently updated</option>
        </select>
        <button onClick={() => setEditing('new')}>+ New task</button>
      </section>

      {tasks.error && <div className="error">{tasks.error.message}</div>}

      <section className="board">
        {STATUSES.map((status) => {
          const items = tasks.data?.items.filter((t) => t.status === status) || [];
          return (
            <div
              key={status}
              className="column"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/plain');
                const task = tasks.data?.items.find((t) => t.id === id);
                if (task && task.status !== status) move.mutate({ id, status });
              }}
            >
              <h3>{label(status)} <span className="count">{items.length}</span></h3>
              {items.map((t) => (
                <article
                  key={t.id}
                  className={`task prio-${t.priority}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                  onClick={() => setEditing(t)}
                >
                  <div className="task-title">{t.title}</div>
                  <div className="task-meta">
                    <span className={`chip prio-${t.priority}`}>{label(t.priority)}</span>
                    {t.dueDate && <Due date={t.dueDate} done={t.status === 'DONE'} />}
                    {t.assignee && <span className="avatar" title={t.assignee.name}>{t.assignee.name[0]}</span>}
                  </div>
                </article>
              ))}
            </div>
          );
        })}
      </section>

      {tasks.data?.totalPages > 1 && (
        <div className="pager">
          <button className="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="muted">Page {page} of {tasks.data.totalPages}</span>
          <button className="ghost" disabled={page >= tasks.data.totalPages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}

      {editing && <TaskModal task={editing === 'new' ? null : editing} users={users.data} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Stat({ title, value, sub, tone }) {
  return (
    <div className={`card stat ${tone || ''}`}>
      <div className="muted small">{title}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

function Due({ date, done }) {
  const d = new Date(date);
  const overdue = !done && d < new Date();
  return <span className={`due ${overdue ? 'overdue' : ''}`}>{d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>;
}
