import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarBlank, CaretLeft, CaretRight, Plus } from '@phosphor-icons/react';
import { api, toQuery } from '../api.js';
import { canManage, useAuth } from '../auth.jsx';
import { PRIORITY_LABEL, STATUSES, STATUS_META } from '../constants.js';
import TaskModal, { toInputDate } from '../components/TaskModal.jsx';
import { Avatar, Modal, useToast } from '../components/ui.jsx';
import { Legend } from '../components/charts.jsx';

const MAX_CHIPS = 3;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => toInputDate(a) === toInputDate(b);

// 6-week grid starting on Monday, in the viewer's local time.
function monthGrid(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export default function Calendar() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [editing, setEditing] = useState(null);
  const [dayOpen, setDayOpen] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overDay, setOverDay] = useState(null);

  const days = useMemo(() => monthGrid(cursor), [cursor]);
  const range = { from: days[0].toISOString(), to: addDays(days[41], 1).toISOString() };
  const tasks = useQuery({ queryKey: ['tasks', 'calendar', range.from], queryFn: () => api(`/tasks/calendar${toQuery(range)}`), placeholderData: (p) => p });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users'), enabled: canManage(user) });

  const byDay = useMemo(() => {
    const map = {};
    tasks.data?.forEach((t) => { (map[toInputDate(t.dueDate)] ??= []).push(t); });
    return map;
  }, [tasks.data]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['stats'] }); };

  // Drag a task to another day to reschedule it; keeps the original time of day.
  const reschedule = useMutation({
    mutationFn: ({ task, day }) => {
      const next = new Date(task.dueDate);
      next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
      return api(`/tasks/${task.id}`, { method: 'PATCH', body: { dueDate: next.toISOString() } });
    },
    onSuccess: (_d, { day }) => toast(`Rescheduled to ${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`),
    onError: (e) => toast(e.message, 'error'),
    onSettled: refresh,
  });

  const canReschedule = (t) => canManage(user) || t.creatorId === user.id;
  const today = new Date();
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = days.slice(0, 7).map((d) => d.toLocaleDateString(undefined, { weekday: 'short' }));
  const inMonth = (d) => d.getMonth() === cursor.getMonth();
  const monthTasks = days.filter(inMonth).filter((d) => byDay[toInputDate(d)]?.length);

  function drop(day) {
    setOverDay(null);
    const task = tasks.data?.find((t) => t.id === dragId);
    setDragId(null);
    if (task && !sameDay(task.dueDate, day)) reschedule.mutate({ task, day });
  }

  const chip = (t, draggable = true) => (
    <button key={t.id} type="button" className={`cal-chip ${t.status === 'DONE' ? 'is-done' : ''}`} style={{ '--sc': STATUS_META[t.status].color }}
      draggable={draggable && canReschedule(t)}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); setDragId(t.id); }}
      onDragEnd={() => { setDragId(null); setOverDay(null); }}
      onClick={(e) => { e.stopPropagation(); setDayOpen(null); setEditing({ task: t }); }}
      title={`${t.title} · ${STATUS_META[t.status].label} · ${PRIORITY_LABEL[t.priority]}`}
      aria-label={`${t.title}, ${STATUS_META[t.status].label}, ${PRIORITY_LABEL[t.priority]} priority`}>
      <span className="cal-dot" aria-hidden="true" />
      <span className="cal-title">{t.title}</span>
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p>Tasks by due date. Drag a task to reschedule it, or click a day to add one.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ defaults: { dueDate: toInputDate(new Date()) } })}>
          <Plus size={18} weight="bold" /> New task
        </button>
      </div>

      <div className="card cal">
        <div className="cal-head">
          <div className="cal-nav">
            <button type="button" className="btn btn-secondary btn-icon" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><CaretLeft size={18} /></button>
            <button type="button" className="btn btn-secondary btn-icon" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><CaretRight size={18} /></button>
            <h2 aria-live="polite">{monthLabel}</h2>
          </div>
          <div className="cal-nav">
            <Legend items={STATUSES.map((s) => ({ label: STATUS_META[s].label, color: STATUS_META[s].color }))} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
          </div>
        </div>

        {/* Month grid (tablet/desktop) */}
        <div className="cal-grid" role="grid" aria-label={monthLabel} aria-busy={tasks.isFetching}>
          <div className="cal-row cal-weekdays" role="row">
            {weekdays.map((w) => <div key={w} role="columnheader">{w}</div>)}
          </div>
          {[0, 1, 2, 3, 4, 5].map((week) => (
            <div key={week} className="cal-row" role="row">
              {days.slice(week * 7, week * 7 + 7).map((d) => {
                const key = toInputDate(d);
                const list = byDay[key] || [];
                const isToday = sameDay(d, today);
                return (
                  <div key={key} role="gridcell"
                    className={`cal-cell ${inMonth(d) ? '' : 'out'} ${isToday ? 'today' : ''} ${overDay === key && dragId ? 'drop-target' : ''}`}
                    onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overDay !== key) setOverDay(key); } }}
                    onDrop={(e) => { e.preventDefault(); drop(d); }}
                    aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length} tasks`}>
                    <div className="cal-cell-head">
                      <span className="cal-date num">{d.getDate()}</span>
                      <button type="button" className="cal-add" aria-label={`Add task on ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`}
                        onClick={() => setEditing({ defaults: { dueDate: key } })}><Plus size={14} weight="bold" /></button>
                    </div>
                    {list.slice(0, MAX_CHIPS).map((t) => chip(t))}
                    {list.length > MAX_CHIPS && (
                      <button type="button" className="cal-more" onClick={() => setDayOpen(d)}>+{list.length - MAX_CHIPS} more</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Agenda list (phones) */}
        <div className="cal-agenda">
          {monthTasks.length === 0 && (
            <div className="empty-col" style={{ margin: 16 }}><CalendarBlank size={28} aria-hidden="true" />Nothing due in {monthLabel}</div>
          )}
          {monthTasks.map((d) => (
            <section key={toInputDate(d)} className={`agenda-day ${sameDay(d, today) ? 'today' : ''}`}>
              <h3>{d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</h3>
              {byDay[toInputDate(d)].map((t) => (
                <button key={t.id} type="button" className="agenda-item" style={{ '--sc': STATUS_META[t.status].color }} onClick={() => setEditing({ task: t })}>
                  <span className="cal-dot" aria-hidden="true" />
                  <span className="agenda-title">{t.title}<small>{STATUS_META[t.status].label} · {PRIORITY_LABEL[t.priority]}</small></span>
                  <Avatar user={t.assignee} size={24} />
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>

      {dayOpen && (
        <Modal title={dayOpen.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} onClose={() => setDayOpen(null)} labelledBy="day-title">
          <div className="modal-body" style={{ gap: 8 }}>
            {(byDay[toInputDate(dayOpen)] || []).map((t) => chip(t, false))}
          </div>
          <div className="modal-foot">
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={() => { const key = toInputDate(dayOpen); setDayOpen(null); setEditing({ defaults: { dueDate: key } }); }}>
              <Plus size={18} weight="bold" /> Add task
            </button>
          </div>
        </Modal>
      )}

      {editing && (
        <TaskModal task={editing.task} defaults={editing.defaults} users={users.data}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { refresh(); toast(msg); setEditing(null); }} />
      )}
    </>
  );
}
