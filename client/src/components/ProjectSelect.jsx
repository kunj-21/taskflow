import { useSearchParams } from 'react-router-dom';
import { useProjects } from '../hooks.js';

// Project filter kept in the URL (?project=<id>) so it survives reloads and can be linked to.
export function useProjectFilter() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get('project') || '';
  const setProjectId = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('project', id); else next.delete('project');
    setParams(next, { replace: true });
  };
  return [projectId, setProjectId];
}

export default function ProjectSelect({ value, onChange, allLabel = 'All projects', className = 'select', ...rest }) {
  const projects = useProjects();
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by project" {...rest}>
      <option value="">{allLabel}</option>
      {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
    </select>
  );
}
