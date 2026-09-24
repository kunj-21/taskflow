import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle, ListChecks, MagnifyingGlass, Plus, Tray, WarningOctagon } from '@phosphor-icons/react';
import { api, toQuery } from '../api.js';
import { canManage, useAuth } from '../auth.jsx';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_META } from '../constants.js';
import TaskModal from '../components/TaskModal.jsx';
import TaskCard from '../components/TaskCard.jsx';
import { useDebounced, useToast } from '../components/ui.jsx';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const manager = canManage(user);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ priority: '', assigneeId: '', sort: 'dueDate:asc' });
  const [editing, setEditing] = useState(null); // null | { task } | { defaults }
  const [draggingId, setDraggingId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const debouncedSearch = useDebounced(search.trim());

  const [sortBy, order] = filters.sort.split(':');
  const params = { search: debouncedSearch, priority: filters.priority, assigneeId: filters.assigneeId, sortBy, order, limit: 100 };

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api('/tasks/stats') });
  const tasks = useQuery({ queryKey: ['tasks', params], queryFn: () => api(`/tasks${toQuery(params)}`), placeholderData: (prev) => prev });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users'), enabled: manager });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['stats'] }); };

  // Optimistic move: the card jumps columns immediately, rolls back if the server refuses.
  const move = useMutation({
    mutationFn: ({ id, status }) => api(`/tasks/${id}`, { method: 'PATCH', body: { status } }),
    onMutate: async ({ id, status }) => {
      const key = ['tasks', params];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old) => old && { ...old, items: old.items.map((t) => (t.id === id ? { ...t, status } : t)) });
      return { prev, key };
    },
    onError: (err, _v, ctx) => { qc.setQueryData(ctx.key, ctx.prev); toast(err.message, 'error'); },
    onSuccess: (_d, { status }) => toast(`Moved to ${STATUS_META[status].label}`),
    onSettled: refresh,
  });

  const byStatus = useMemo(() => {
    const groups = Object.fromEntries(STATUSES.map((s) => [s, []]));
    tasks.data?.items.forEach((t) => groups[t.status].push(t));
    return groups;
  }, [tasks.data]);

  const s = stats.data;
  const total = s ? Object.values(s.byStatus).reduce((a, b) => a + b, 0) : 0;
  const done = s?.byStatus.DONE || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const hasFilters = search || filters.priority || filters.assigneeId;
  const firstName = user.name.split(' ')[0];

  function drop(status) {
    setOverCol(null);
    const task = tasks.data?.items.find((t) => t.id === draggingId);
    setDraggingId(null);
    if (task && task.status !== status) move.mutate({ id: task.id, status });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {manager ? 'Here’s how your team is doing.' : 'Here’s what’s on your plate.'}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ defaults: {} })}>
          <Plus size={18} weight="bold" /> New task
        </button>
      </div>

      <section className="stats" aria-label="Task summary">
        <StatCard label="Total tasks" icon={<ListChecks size={20} weight="bold" />} color="var(--primary)" loading={!s} value={total}>
          {s && total > 0 && (
            <div className="dist" role="img" aria-label={STATUSES.map((st) => `${STATUS_META[st].label}: ${s.byStatus[st] || 0}`).join(', ')}>
              {STATUSES.map((st) => <span key={st} style={{ flexGrow: s.byStatus[st] || 0, background: STATUS_META[st].color }} />)}
            </div>
          )}
        </StatCard>
        <StatCard label="Completed" icon={<CheckCircle size={20} weight="bold" />} color="var(--success)" loading={!s} value={`${pct}%`}>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Completion"><span style={{ width: `${pct}%` }} /></div>
          <div className="stat-sub num">{done} of {total} tasks done</div>
        </StatCard>
        <StatCard label="Due this week" icon={<CalendarCheck size={20} weight="bold" />} color="var(--s-review)" loading={!s} value={s?.dueThisWeek}>
          <div className="stat-sub">Open tasks due in the next 7 days</div>
        </StatCard>
        <StatCard label="Overdue" icon={<WarningOctagon size={20} weight="bold" />} color="var(--danger)" loading={!s} value={s?.overdue}>
          <div className={`stat-sub ${s?.overdue ? 'bad' : ''}`}>{s?.overdue ? 'Needs attention' : 'All caught up'}</div>
        </StatCard>
      </section>

      <div className="toolbar" role="search">
        <div className="input-wrap search">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <input className="input" type="search" placeholder="Search tasks" aria-label="Search tasks" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="select" aria-label="Filter by priority" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select className="select" aria-label="Filter by assignee" value={filters.assigneeId} onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value })}>
          <option value="">{manager ? 'Everyone' : 'All my tasks'}</option>
          <option value="me">Assigned to me</option>
          {users.data?.filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="select" aria-label="Sort tasks" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
          <option value="dueDate:asc">Due soonest</option>
          <option value="priority:desc">Highest priority</option>
          <option value="createdAt:desc">Newest first</option>
          <option value="updatedAt:desc">Recently updated</option>
        </select>
        {hasFilters && (
          <button type="button" className="btn btn-ghost" onClick={() => { setSearch(''); setFilters({ ...filters, priority: '', assigneeId: '' }); }}>Clear filters</button>
        )}
      </div>

      {tasks.error && <div className="alert alert-error" role="alert">Couldn’t load tasks: {tasks.error.message} <button className="link-btn" onClick={() => tasks.refetch()}>Retry</button></div>}

      <section className="board" aria-label="Task board">
        {STATUSES.map((status) => {
          const items = byStatus[status];
          const meta = STATUS_META[status];
          return (
            <div
              key={status}
              className={`column ${overCol === status && draggingId ? 'drop-target' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (overCol !== status) setOverCol(status); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(null); }}
              onDrop={(e) => { e.preventDefault(); drop(status); }}
              aria-labelledby={`col-${status}`}
              role="region"
            >
              <div className="column-head">
                <span className="status-dot" style={{ '--sc': meta.color }} aria-hidden="true" />
                <h2 id={`col-${status}`}>{meta.label}</h2>
                <span className="count num" aria-label={`${items.length} tasks`}>{items.length}</span>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={`Add task to ${meta.label}`} title={`Add to ${meta.label}`} onClick={() => setEditing({ defaults: { status } })}>
                  <Plus size={16} weight="bold" />
                </button>
              </div>

              {tasks.isLoading
                ? [0, 1].map((i) => <div key={i} className="skeleton task-skel" aria-hidden="true" />)
                : items.length
                  ? items.map((t, i) => (
                    <TaskCard key={t.id} task={t} index={i} dragging={draggingId === t.id}
                      onOpen={(task) => setEditing({ task })}
                      onDragStart={setDraggingId}
                      onDragEnd={() => { setDraggingId(null); setOverCol(null); }} />
                  ))
                  : (
                    <div className="empty-col">
                      <Tray size={28} aria-hidden="true" />
                      {hasFilters ? 'No matching tasks' : status === 'DONE' ? 'Nothing finished yet' : 'No tasks here'}
                    </div>
                  )}
            </div>
          );
        })}
      </section>

      {editing && (
        <TaskModal
          task={editing.task}
          defaults={editing.defaults}
          users={users.data}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { refresh(); toast(msg); setEditing(null); }}
        />
      )}
    </>
  );
}

function StatCard({ label, icon, color, value, loading, children }) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon" style={{ '--ic': color }} aria-hidden="true">{icon}</span>
      </div>
      {loading ? <div className="skeleton" style={{ height: 30, width: 70 }} /> : <div className="stat-value num">{value}</div>}
      {!loading && children}
    </div>
  );
}
