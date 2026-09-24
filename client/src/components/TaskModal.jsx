import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { canManage, useAuth } from '../auth.jsx';
import { PRIORITIES, STATUSES } from '../constants.js';

const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export default function TaskModal({ task, users, onClose }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isNew = !task;
  const manager = canManage(user);
  // Members can fully edit their own tasks; on tasks assigned by others they only move status.
  const statusOnly = !isNew && !manager && task.creatorId !== user.id;

  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    status: task?.status || 'TODO',
    priority: task?.priority || 'MEDIUM',
    dueDate: toInputDate(task?.dueDate),
    assigneeId: task?.assigneeId ?? user.id,
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      const body = statusOnly
        ? { status: form.status }
        : { ...form, description: form.description || null, dueDate: form.dueDate ? new Date(`${form.dueDate}T17:00:00`).toISOString() : null, assigneeId: form.assigneeId || null };
      return isNew ? api('/tasks', { method: 'POST', body }) : api(`/tasks/${task.id}`, { method: 'PATCH', body });
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api(`/tasks/${task.id}`, { method: 'DELETE' }), onSuccess: done });
  const canDelete = !isNew && (manager || task.creatorId === user.id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{isNew ? 'New task' : 'Edit task'}</h2>
        <label>Title<input value={form.title} onChange={set('title')} required disabled={statusOnly} autoFocus /></label>
        <label>Description<textarea rows={3} value={form.description} onChange={set('description')} disabled={statusOnly} /></label>
        <div className="row">
          <label>Status
            <select value={form.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label>Priority
            <select value={form.priority} onChange={set('priority')} disabled={statusOnly}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
        </div>
        <div className="row">
          <label>Due date<input type="date" value={form.dueDate} onChange={set('dueDate')} disabled={statusOnly} /></label>
          <label>Assignee
            <select value={form.assigneeId || ''} onChange={set('assigneeId')} disabled={statusOnly || !manager}>
              <option value="">Unassigned</option>
              {(manager ? users || [] : [user]).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              {!manager && task?.assignee && task.assigneeId !== user.id && <option value={task.assigneeId}>{task.assignee.name}</option>}
            </select>
          </label>
        </div>
        {!isNew && <p className="muted small">Created by {task.creator?.name}</p>}
        {(save.error || remove.error) && <div className="error">{(save.error || remove.error).message}</div>}
        <div className="actions">
          {canDelete && <button type="button" className="danger" onClick={() => confirm('Delete this task?') && remove.mutate()}>Delete</button>}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
