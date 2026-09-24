import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { ArrowSquareOut, CalendarDots, ChartLineUp, CheckSquareOffset, Desktop, FileCode, Kanban, Moon, SignOut, Sun, UsersThree } from '@phosphor-icons/react';
import { useAuth } from '../auth.jsx';
import { useRealtime } from '../useRealtime.js';
import { Avatar } from './ui.jsx';

export function Logo({ to = '/' }) {
  return (
    <Link to={to} className="logo" aria-label="TaskFlow home">
      <span className="logo-mark"><CheckSquareOffset size={20} weight="bold" /></span>
      <span className="logo-text">TaskFlow</span>
    </Link>
  );
}

const THEMES = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'system', label: 'System theme', Icon: Desktop },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
];

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('tf-theme') || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === 'system') localStorage.removeItem('tf-theme');
      else localStorage.setItem('tf-theme', theme);
    } catch { /* storage unavailable */ }
  }, [theme]);
  return [theme, setTheme];
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useTheme();
  useRealtime(Boolean(user));

  const links = (
    <>
      <NavLink to="/" end className="nav-link"><Kanban size={20} /><span>Board</span></NavLink>
      <NavLink to="/calendar" className="nav-link"><CalendarDots size={20} /><span>Calendar</span></NavLink>
      <NavLink to="/analytics" className="nav-link"><ChartLineUp size={20} /><span>Analytics</span></NavLink>
      {user.role === 'ADMIN' && <NavLink to="/users" className="nav-link"><UsersThree size={20} /><span>Team</span></NavLink>}
      <a href="/api/docs" target="_blank" rel="noreferrer" className="nav-link">
        <FileCode size={20} /><span>API docs</span><ArrowSquareOut size={14} className="ext" aria-hidden="true" />
      </a>
    </>
  );

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>

      <aside className="sidebar" aria-label="Primary">
        <Logo />
        <nav aria-label="Main navigation" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="nav-section">Workspace</div>
          {links}
        </nav>

        <div className="sidebar-foot">
          <div className="theme-switch" role="group" aria-label="Color theme">
            {THEMES.map(({ value, label, Icon }) => (
              <button key={value} type="button" aria-pressed={theme === value} aria-label={label} title={label} onClick={() => setTheme(value)}>
                <Icon size={16} weight={theme === value ? 'fill' : 'regular'} />
              </button>
            ))}
          </div>
          <div className="user-card">
            <Avatar user={user} className="avatar-lg" />
            <div className="who">
              <div className="name">{user.name}</div>
              <span className={`badge role-${user.role}`}>{user.role.toLowerCase()}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-icon" onClick={logout} aria-label="Log out" title="Log out">
              <SignOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="mobile-bar">
          <Logo />
          <nav aria-label="Main navigation" style={{ display: 'flex', gap: 2 }}>{links}</nav>
          <button type="button" className="btn btn-ghost btn-icon" onClick={logout} aria-label="Log out"><SignOut size={18} /></button>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
