import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';

/* ---------- Avatar: image or initials on a stable per-user color ---------- */
const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#059669', '#4f46e5', '#b45309'];
const colorFor = (seed = '') => AVATAR_COLORS[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];
const initials = (name = '?') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

export function Avatar({ user, size, className = '' }) {
  if (!user) return <span className={`avatar avatar-empty ${className}`} style={size && { '--size': `${size}px` }} title="Unassigned" aria-label="Unassigned">?</span>;
  return (
    <span className={`avatar ${className}`} style={{ '--av': colorFor(user.id || user.email), ...(size && { '--size': `${size}px` }) }} title={user.name}>
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials(user.name)}
      <span className="sr-only">{user.name}</span>
    </span>
  );
}

/* ---------- Toasts (aria-live, auto-dismiss) ---------- */
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'error' ? <WarningCircle size={20} weight="fill" /> : <CheckCircle size={20} weight="fill" />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ---------- Debounce hook for search inputs ---------- */
export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ---------- Modal: Escape to close, focus trap-lite, restore focus ---------- */
export function Modal({ title, onClose, children, footer, labelledBy = 'modal-title' }) {
  // Latest onClose via ref so the mount effect runs once (parents often pass inline callbacks).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <div className="modal-head">
          <h2 id={labelledBy}>{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close dialog">
            <X size={18} weight="bold" />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

export const Spinner = () => <span className="spinner" aria-hidden="true" />;
