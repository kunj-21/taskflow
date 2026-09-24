import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowsClockwise, CheckCircle, PlusCircle, Timer } from '@phosphor-icons/react';
import { api, toQuery } from '../api.js';
import ProjectSelect, { useProjectFilter } from '../components/ProjectSelect.jsx';
import { canManage, useAuth } from '../auth.jsx';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_META } from '../constants.js';
import { ChartCard, ColumnChart, DataTable, Legend, LineChart, StackedBars } from '../components/charts.jsx';

const RANGES = [7, 30, 90];

// Series colors carry the same meaning as the board: new work = To do, finished = Done.
const TREND = [
  { key: 'created', label: 'Created', color: 'var(--s-todo)' },
  { key: 'completed', label: 'Completed', color: 'var(--s-done)' },
];
const STATUS_SEGMENTS = STATUSES.map((s) => ({ key: s, label: STATUS_META[s].label, color: STATUS_META[s].color }));

const fmtDay = (iso, long) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, long
  ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
  : { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function Analytics() {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const [projectId, setProjectId] = useProjectFilter();
  const q = useQuery({ queryKey: ['tasks', 'analytics', days, projectId], queryFn: () => api(`/tasks/analytics${toQuery({ days, projectId })}`), placeholderData: (p) => p });
  const a = q.data;

  const workloadRows = a?.workload.map((w) => ({ ...w, name: w.user?.name || 'Unassigned' })) || [];
  const priorityData = PRIORITIES.map((p) => ({ label: PRIORITY_LABEL[p], value: a?.openByPriority[p] || 0 }));
  const net = a ? a.totals.completed - a.totals.created : 0;

  const rangePicker = (
    <div className="chip-toggle" role="group" aria-label="Time range">
      {RANGES.map((d) => (
        <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>
      ))}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p>{canManage(user) ? 'Throughput and workload across the whole team.' : 'Your throughput and workload.'} Days are in UTC.</p>
        </div>
        <div className="head-controls">
          <ProjectSelect value={projectId} onChange={setProjectId} />
          {rangePicker}
        </div>
      </div>

      {q.error && <div className="alert alert-error" role="alert">Couldn’t load analytics: {q.error.message}</div>}

      <section className="stats" aria-label={`Last ${days} days`}>
        <Tile label="Created" icon={<PlusCircle size={20} weight="bold" />} color="var(--s-todo)" value={a?.totals.created} sub={`in the last ${days} days`} />
        <Tile label="Completed" icon={<CheckCircle size={20} weight="bold" />} color="var(--s-done)" value={a?.totals.completed} sub={`in the last ${days} days`} />
        <Tile label="Net progress" icon={<ArrowsClockwise size={20} weight="bold" />} color="var(--primary)" value={a ? (net > 0 ? `+${net}` : net) : undefined}
          sub={net >= 0 ? 'Finishing faster than new work arrives' : 'Backlog is growing'} />
        <Tile label="Avg. time to complete" icon={<Timer size={20} weight="bold" />} color="var(--viz-single)"
          value={a ? (a.totals.avgCycleDays == null ? '—' : `${a.totals.avgCycleDays}d`) : undefined} sub="From created to done" />
      </section>

      <div className="viz-grid-layout">
        <ChartCard
          title="Created vs. completed"
          subtitle={`Tasks per day, last ${days} days`}
          table={<DataTable caption="Tasks created and completed per day"
            columns={[{ key: 'day', label: 'Day' }, { key: 'created', label: 'Created', numeric: true }, { key: 'completed', label: 'Completed', numeric: true }]}
            rows={(a?.series || []).map((d) => ({ ...d, day: fmtDay(d.date, true) })).reverse()} />}
        >
          <Legend items={TREND} />
          {a ? (
            <LineChart data={a.series} xKey="date" series={TREND} formatX={fmtDay}
              summary={`Line chart of tasks created and completed per day over ${days} days. ${a.totals.created} created, ${a.totals.completed} completed.`} />
          ) : <div className="skeleton" style={{ height: 260 }} />}
        </ChartCard>

        <ChartCard
          title="Workload by person"
          subtitle="All tasks by current status"
          table={<DataTable caption="Tasks per person by status"
            columns={[{ key: 'name', label: 'Person' }, ...STATUS_SEGMENTS.map((s) => ({ key: s.key, label: s.label, numeric: true })), { key: 'open', label: 'Open', numeric: true }]}
            rows={workloadRows} />}
        >
          <Legend items={STATUS_SEGMENTS} />
          {a ? (
            workloadRows.length ? (
              <StackedBars rows={workloadRows} segments={STATUS_SEGMENTS} labelFor={(r) => r.name}
                summary={`Stacked bar chart of tasks per person by status. ${workloadRows.map((r) => `${r.name}: ${r.open} open`).join(', ')}.`} />
            ) : <p className="muted viz-empty">No assigned tasks yet.</p>
          ) : <div className="skeleton" style={{ height: 180 }} />}
        </ChartCard>

        <ChartCard
          title="Open tasks by priority"
          subtitle="Everything not done yet"
          table={<DataTable caption="Open tasks by priority" columns={[{ key: 'label', label: 'Priority' }, { key: 'value', label: 'Open tasks', numeric: true }]} rows={priorityData} />}
        >
          {a ? (
            <ColumnChart data={priorityData} color="var(--viz-single)"
              summary={`Column chart of open tasks by priority. ${priorityData.map((d) => `${d.label}: ${d.value}`).join(', ')}.`} />
          ) : <div className="skeleton" style={{ height: 220 }} />}
        </ChartCard>
      </div>
    </>
  );
}

function Tile({ label, icon, color, value, sub }) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon" style={{ '--ic': color }} aria-hidden="true">{icon}</span>
      </div>
      {value === undefined ? <div className="skeleton" style={{ height: 30, width: 70 }} /> : <div className="stat-value num">{value}</div>}
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
