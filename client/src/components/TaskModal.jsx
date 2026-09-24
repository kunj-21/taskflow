import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Info, Trash, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api.js';
import { canManage, useAuth } from '../auth.jsx';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_META } from '../constants.js';
import { Avatar, Modal, Spinner } from './ui.jsx';
import { taskKey, useMembers, useProjects } from '../hooks.js';

export const toInputDate = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export default function TaskModal({ task, defaults = {}, onClose, onSaved }) {
  const { user } = useAuth();
  const isNew = !task;
  const manager = canManage(user);
  // Members fully edit tasks they created; on tasks assigned by someone else they can only move status.
  const statusOnly = !isNew && !manager && task.creatorId !== user.id;
  const canDelete = !isNew && (manager || task.creatorId === user.id);

  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    status: task?.status || defaults.status || 'TODO',
    priority: task?.priority || 'MEDIUM',
    dueDate: task ? toInputDate(task.dueDate) : defaults.dueDate || '',
    assigneeId: task ? task.assigneeId ?? '' : user.id,
    projectId: task?.projectId || defaults.projectId || '',
  });
  const members = useMembers(manager);
  const projects = useProjects();

  // New task with no project chosen yet: default to the first active project once they load.
  useEffect(() => {
    if (isNew && !form.projectId && projects.data?.length) setForm((f) => ({ ...f, projectId: projects.data[0].id }));
  }, [isNew, form.projectId, projects.data]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [titleError, setTitleError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: () => {
      const body = statusOnly
        ? { status: form.status }
        : {
          title: form.title.trim(),
          description: form.description.trim() || null,
          status: form.status,
          priority: form.priority,
          dueDate: form.dueDate ? new Date(`${form.dueDate}T17:00:00`).toISOString() : null,
          assigneeId: form.assigneeId || null,
          ...(isNew && { projectId: form.projectId }),
        };
      return isNew ? api('/tasks', { method: 'POST', body }) : api(`/tasks/${task.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => onSaved(isNew ? 'Task created' : 'Changes saved'),
  });
  const remove = useMutation({
    mutationFn: () => api(`/tasks/${task.id}`, { method: 'DELETE' }),
    onSuccess: () => onSaved('Task deleted'),
  });

  function submit(e) {
    e.preventDefault();
    if (!statusOnly && !form.title.trim()) {
      setTitleError('Give the task a title so your team knows what it is.');
      document.getElementById('task-title')?.focus();
      return;
    }
    save.mutate();
  }

  const assignees = manager ? members.data || [] : [user];
  const error = save.error || remove.error;

  return (
    <Modal
      title={isNew ? 'New task' : `${statusOnly ? 'Update' : 'Edit'} ${taskKey(task)}`}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          {statusOnly && (
            <div className="notice"><Info size={18} aria-hidden="true" />Assigned to you by {task.creator?.name}. You can update its status.</div>
          )}

          <div className="field">
            <label htmlFor="task-project">Project</label>
            {isNew ? (
              <select id="task-project" className="select" value={form.projectId} onChange={set('projectId')} required>
                {!projects.data?.length && <option value="">No active projects</option>}
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
              </select>
            ) : (
              <input id="task-project" className="input" value={`${task.project.key} · ${task.project.name}`} readOnly />
            )}
          </div>

          <div className="field">
            <label htmlFor="task-title">Title<span className="req" aria-hidden="true">*</span></label>
            <input id="task-title" className="input" value={form.title} onChange={(e) => { set('title')(e); setTitleError(''); }}
              disabled={statusOnly} autoFocus={!statusOnly} maxLength={200} required
              aria-invalid={Boolean(titleError)} aria-describedby={titleError ? 'title-err' : undefined} placeholder="e.g. Draft Q4 launch plan" />
            {titleError && <div id="title-err" className="field-error" role="alert">{titleError}</div>}
          </div>

          <div className="field">
            <label htmlFor="task-desc">Description</label>
            <textarea id="task-desc" className="textarea" rows={3} value={form.description} onChange={set('description')} disabled={statusOnly} placeholder="Add details, links or acceptance criteria" maxLength={5000} />
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="task-status">Status</label>
              <select id="task-status" className="select" value={form.status} onChange={set('status')} autoFocus={statusOnly}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="task-priority">Priority</label>
              <select id="task-priority" className="select" value={form.priority} onChange={set('priority')} disabled={statusOnly}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="task-due">Due date</label>
              <input id="task-due" type="date" className="input" value={form.dueDate} onChange={set('dueDate')} disabled={statusOnly} />
              {!statusOnly && <span className="hint">Assignee gets an email reminder a day before.</span>}
            </div>
            <div className="field">
              <label htmlFor="task-assignee">Assignee</label>
              <select id="task-assignee" className="select" value={form.assigneeId} onChange={set('assigneeId')} disabled={statusOnly || !manager}>
                <option value="">Unassigned</option>
                {assignees.map((u) => <option key={u.id} value={u.id}>{u.id === user.id ? `${u.name} (you)` : u.name}</option>)}
                {!manager && task?.assignee && task.assigneeId !== user.id && <option value={task.assigneeId}>{task.assignee.name}</option>}
              </select>
              {!manager && !statusOnly && <span className="hint">Only managers can assign tasks to others.</span>}
            </div>
          </div>

          {!isNew && (
            <div className="meta-line">
              <Avatar user={task.creator} size={20} />
              Created by {task.creator?.name} · {new Date(task.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}

          {error && <div className="alert alert-error" role="alert"><WarningCircle size={18} aria-hidden="true" />{error.message}</div>}
        </div>

        <div className="modal-foot">
          {canDelete && (confirmDelete ? (
            <>
              <span className="muted" style={{ fontSize: 13 }}>Delete permanently?</span>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {remove.isPending ? <Spinner /> : 'Delete'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Keep</button>
            </>
          ) : (
            <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirmDelete(true)}>
              <Trash size={18} /> Delete
            </button>
          ))}
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? <><Spinner /> Saving</> : isNew ? 'Create task' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
