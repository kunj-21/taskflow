import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowCounterClockwise, FolderSimple, Kanban, Plus, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api.js';
import { canManage, useAuth } from '../auth.jsx';
import { useProjects } from '../hooks.js';
import { Modal, Spinner, useToast } from '../components/ui.jsx';

const suggestKey = (name) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] || '').slice(0, 3);
  return key.replace(/^[0-9]+/, '').slice(0, 6);
};

export default function Projects() {
  const { user } = useAuth();
  const manager = canManage(user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const projects = useProjects({ includeArchived: showArchived });

  const archive = useMutation({
    mutationFn: ({ p, archived }) => api(`/projects/${p.id}`, { method: 'PATCH', body: { archived } }),
    onSuccess: (p, { archived }) => { qc.invalidateQueries({ queryKey: ['projects'] }); toast(`${p.name} ${archived ? 'archived' : 'restored'}`); },
    onError: (e) => toast(e.message, 'error'),
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>Group work by team, product or client. Task numbers use the project key, like WEB-42.</p>
        </div>
        {manager && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={18} weight="bold" /> New project</button>}
      </div>

      <div className="toolbar">
        <div className="chip-toggle" role="group" aria-label="Which projects">
          <button type="button" aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>Active</button>
          <button type="button" aria-pressed={showArchived} onClick={() => setShowArchived(true)}>Include archived</button>
        </div>
      </div>

      <div className="project-grid">
        {projects.isLoading && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 150 }} />)}
        {projects.data?.map((p) => (
          <article key={p.id} className={`card project-card ${p.archivedAt ? 'archived' : ''}`}>
            <div className="project-top">
              <span className="project-key">{p.key}</span>
              {p.archivedAt && <span className="badge">Archived</span>}
            </div>
            <h2>{p.name}</h2>
            <p className="muted">{p.description || 'No description'}</p>
            <div className="project-foot">
              <span className="muted num">{p.taskCount} task{p.taskCount === 1 ? '' : 's'}</span>
              <span className="spacer" />
              {!p.archivedAt && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/?project=${p.id}`)}><Kanban size={16} /> Open board</button>
              )}
              {manager && (p.archivedAt ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => archive.mutate({ p, archived: false })}><ArrowCounterClockwise size={16} /> Restore</button>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => archive.mutate({ p, archived: true })} aria-label={`Archive ${p.name}`}><Archive size={16} /></button>
              ))}
            </div>
          </article>
        ))}
        {projects.data?.length === 0 && (
          <div className="empty-col" style={{ gridColumn: '1 / -1' }}><FolderSimple size={28} aria-hidden="true" />No projects yet</div>
        )}
      </div>

      {creating && <CreateProject onClose={() => setCreating(false)} onCreated={(p) => { qc.invalidateQueries({ queryKey: ['projects'] }); toast(`${p.name} created`); setCreating(false); }} />}
    </>
  );
}

function CreateProject({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', key: '', description: '' });
  const [keyEdited, setKeyEdited] = useState(false);
  const create = useMutation({ mutationFn: () => api('/projects', { method: 'POST', body: { ...form, description: form.description || null } }), onSuccess: onCreated });

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="p-name">Name</label>
            <input id="p-name" className="input" required autoFocus maxLength={80} value={form.name} placeholder="e.g. Website redesign"
              onChange={(e) => setForm({ ...form, name: e.target.value, key: keyEdited ? form.key : suggestKey(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="p-key">Key</label>
            <input id="p-key" className="input" required value={form.key} maxLength={6} style={{ textTransform: 'uppercase', maxWidth: 160 }}
              pattern="[A-Za-z][A-Za-z0-9]{1,5}" onChange={(e) => { setKeyEdited(true); setForm({ ...form, key: e.target.value.toUpperCase() }); }} aria-describedby="p-key-hint" />
            <span id="p-key-hint" className="hint">2–6 letters or digits. Tasks will be numbered {form.key || 'KEY'}-1, {form.key || 'KEY'}-2… The key can’t be changed later.</span>
          </div>
          <div className="field">
            <label htmlFor="p-desc">Description</label>
            <textarea id="p-desc" className="textarea" rows={2} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {create.error && <div className="alert alert-error" role="alert"><WarningCircle size={18} />{create.error.status === 409 ? `Key ${form.key} is already used by another project.` : create.error.message}</div>}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? <><Spinner /> Creating</> : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}
