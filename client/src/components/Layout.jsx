import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useRealtime } from '../useRealtime.js';

export default function Layout() {
  const { user, logout } = useAuth();
  useRealtime(Boolean(user));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">TaskFlow</div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          {user.role === 'ADMIN' && <NavLink to="/users">Users</NavLink>}
          <a href="/api/docs" target="_blank" rel="noreferrer">API docs</a>
        </nav>
        <div className="me">
          <span className={`badge role-${user.role}`}>{user.role}</span>
          <span>{user.name}</span>
          <button className="ghost" onClick={logout}>Log out</button>
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  );
}
