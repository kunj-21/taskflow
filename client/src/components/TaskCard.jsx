import { CalendarBlank, DotsSixVertical, Flag, WarningCircle } from '@phosphor-icons/react';
import { PRIORITY_LABEL, STATUS_META } from '../constants.js';
import { Avatar } from './ui.jsx';

const DAY = 86400_000;

export function dueInfo(date, done) {
  if (!date) return null;
  const d = new Date(date);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((d - startOfToday) / DAY);
  const label = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (done) return { label, tone: '' };
  if (d < new Date()) return { label: `Overdue · ${label}`, tone: 'overdue' };
  if (days <= 2) return { label, tone: 'soon' };
  return { label, tone: '' };
}

export default function TaskCard({ task, index, onOpen, onDragStart, onDragEnd, dragging }) {
  const due = dueInfo(task.dueDate, task.status === 'DONE');

  return (
    <button
      type="button"
      className={`task ${dragging ? 'dragging' : ''} ${task.status === 'DONE' ? 'is-done' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(task.id); }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task)}
      aria-label={`${task.title}. ${PRIORITY_LABEL[task.priority]} priority, ${STATUS_META[task.status].label}${due ? `, due ${due.label}` : ''}${task.assignee ? `, assigned to ${task.assignee.name}` : ''}. Open to edit.`}
    >
      <div className="task-top">
        <span className={`badge prio prio-${task.priority}`}>
          <Flag size={12} weight="fill" aria-hidden="true" />{PRIORITY_LABEL[task.priority]}
        </span>
        <DotsSixVertical size={18} className="grip" aria-hidden="true" />
      </div>
      <div className="task-title">{task.title}</div>
      {task.description && <div className="task-desc">{task.description}</div>}
      <div className="task-foot">
        {due ? (
          <span className={`due ${due.tone}`}>
            {due.tone === 'overdue' ? <WarningCircle size={14} weight="bold" aria-hidden="true" /> : <CalendarBlank size={14} aria-hidden="true" />}
            {due.label}
          </span>
        ) : <span>No due date</span>}
        <Avatar user={task.assignee} size={26} />
      </div>
    </button>
  );
}
