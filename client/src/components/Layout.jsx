import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowSquareOut, CalendarDots, CaretUpDown, ChartLineUp, Check, CheckSquareOffset, ClockCounterClockwise,
  Desktop, FileCode, FolderSimple, GearSix, Kanban, List, Moon, Plus, SignOut, Sun, UsersThree, X,
} from '@phosphor-icons/react';
import { isAdmin, ROLE_LABEL, useAuth } from '../auth.jsx';
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

const orgInitials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

function OrgSwitcher() {
  const { org, orgs, switchOrg } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="org-switch" ref={ref}>
      <button type="button" className="org-current" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="org-mark" aria-hidden="true">{orgInitials(org?.name)}</span>
        <span className="org-meta">
          <span className="org-name">{org?.name}</span>
          <span className="org-plan">{org?.plan?.toLowerCase()} plan · {ROLE_LABEL[org?.role]?.toLowerCase()}</span>
        </span>
        <CaretUpDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="org-menu" role="menu" aria-label="Switch organization">
          <div className="menu-label">Organizations</div>
          {orgs.map((o) => (
            <button key={o.id} type="button" role="menuitemradio" aria-checked={o.id === org?.id} className="menu-item"
              onClick={() => { setOpen(false); switchOrg(o.id); navigate('/'); }}>
              <span className="org-mark sm" aria-hidden="true">{orgInitials(o.name)}</span>
              <span className="menu-text">{o.name}<small>{ROLE_LABEL[o.role]}</small></span>
              {o.id === org?.id && <Check size={16} weight="bold" aria-hidden="true" />}
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); navigate('/onboarding?new=1'); }}>
            <Plus size={16} aria-hidden="true" /><span className="menu-text">Create organization</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, org, logout } = useAuth();
  const [theme, setTheme] = useTheme();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useRealtime(org?.id);

  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className={`shell ${drawer ? 'drawer-open' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>

      <header className="mobile-bar">
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} aria-controls="sidebar">
          <List size={22} />
        </button>
        <Logo />
        <span className="mobile-org">{org?.name}</span>
      </header>

      {drawer && <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}

      <aside id="sidebar" className="sidebar" aria-label="Primary">
        <div className="sidebar-top">
          <Logo />
          <button type="button" className="btn btn-ghost btn-icon drawer-close" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={20} /></button>
        </div>
        <OrgSwitcher />

        <nav aria-label="Main navigation" className="side-nav">
          <div className="nav-section">Workspace</div>
          <NavLink to="/" end className="nav-link"><Kanban size={20} /><span>Board</span></NavLink>
          <NavLink to="/calendar" className="nav-link"><CalendarDots size={20} /><span>Calendar</span></NavLink>
          <NavLink to="/analytics" className="nav-link"><ChartLineUp size={20} /><span>Analytics</span></NavLink>
          <NavLink to="/projects" className="nav-link"><FolderSimple size={20} /><span>Projects</span></NavLink>

          <div className="nav-section">Organization</div>
          <NavLink to="/team" className="nav-link"><UsersThree size={20} /><span>Team</span></NavLink>
          {isAdmin(user) && <NavLink to="/audit" className="nav-link"><ClockCounterClockwise size={20} /><span>Audit log</span></NavLink>}
          <NavLink to="/settings" className="nav-link"><GearSix size={20} /><span>Settings</span></NavLink>
          <a href="/api/docs" target="_blank" rel="noreferrer" className="nav-link">
            <FileCode size={20} /><span>API docs</span><ArrowSquareOut size={14} className="ext" aria-hidden="true" />
          </a>
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
              <div className="email">{user.email}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-icon" onClick={logout} aria-label="Log out" title="Log out">
              <SignOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

