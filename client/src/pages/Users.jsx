import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });

  const setRole = useMutation({
    mutationFn: ({ id, role }) => api(`/users/${id}/role`, { method: 'PATCH', body: { role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const remove = useMutation({
    mutationFn: (id) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div className="card">
      <h2>Team members</h2>
      {(setRole.error || remove.error) && <div className="error">{(setRole.error || remove.error).message}</div>}
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td className="muted">{u.email}</td>
              <td>
                <select value={u.role} disabled={u.id === me.id} onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })}>
                  <option>ADMIN</option><option>MANAGER</option><option>MEMBER</option>
                </select>
              </td>
              <td>{u.id !== me.id && <button className="ghost danger-text" onClick={() => confirm(`Delete ${u.name}?`) && remove.mutate(u.id)}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
