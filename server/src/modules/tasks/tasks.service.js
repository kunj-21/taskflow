import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/errors.js';
import { cached, namespaceVersion, invalidateNamespace } from '../../utils/cache.js';
import { emitTaskEvent } from '../../sockets/index.js';
import { scheduleTaskReminder, cancelTaskReminder } from '../../jobs/queues.js';

const CACHE_NS = 'tasks';
const isManager = (user) => user.role === 'ADMIN' || user.role === 'MANAGER';

const taskInclude = {
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
};

// Members only see tasks they created or are assigned to; managers/admins see everything.
const visibilityFilter = (user) =>
  isManager(user) ? {} : { OR: [{ creatorId: user.id }, { assigneeId: user.id }] };

export async function listTasks(user, q) {
  const where = {
    AND: [
      visibilityFilter(user),
      q.status ? { status: q.status } : {},
      q.priority ? { priority: q.priority } : {},
      q.assigneeId ? { assigneeId: q.assigneeId === 'me' ? user.id : q.assigneeId } : {},
      q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] } : {},
      q.dueBefore ? { dueDate: { lte: q.dueBefore } } : {},
      q.dueAfter ? { dueDate: { gte: q.dueAfter } } : {},
    ],
  };

  // Cache key includes namespace version + the viewer's scope + normalized query.
  const version = await namespaceVersion(CACHE_NS);
  const scope = isManager(user) ? 'all' : user.id;
  const key = `cache:${CACHE_NS}:${version}:list:${scope}:${JSON.stringify(q)}`;

  return cached(key, async () => {
    const [items, total] = await prisma.$transaction([
      prisma.task.findMany({
        where,
        include: taskInclude,
        orderBy: { [q.sortBy]: q.order },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.task.count({ where }),
    ]);
    return { items, page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
  });
}

async function findVisibleTask(user, id) {
  const task = await prisma.task.findFirst({ where: { id, ...visibilityFilter(user) }, include: taskInclude });
  if (!task) throw ApiError.notFound('Task not found');
  return task;
}

export const getTask = findVisibleTask;

async function assertAssignable(user, assigneeId) {
  if (!assigneeId) return;
  if (!isManager(user) && assigneeId !== user.id) {
    throw ApiError.forbidden('Only managers and admins can assign tasks to other users');
  }
  const exists = await prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true } });
  if (!exists) throw ApiError.badRequest('Assignee does not exist');
}

async function afterWrite(event, task, extraUserIds) {
  await invalidateNamespace(CACHE_NS);
  emitTaskEvent(event, task, extraUserIds);
}

export async function createTask(user, data) {
  const assigneeId = data.assigneeId === undefined ? user.id : data.assigneeId;
  await assertAssignable(user, assigneeId);
  const task = await prisma.task.create({
    data: { ...data, assigneeId, creatorId: user.id, completedAt: data.status === 'DONE' ? new Date() : null },
    include: taskInclude,
  });
  await scheduleTaskReminder(task);
  await afterWrite('task:created', task);
  return task;
}

export async function updateTask(user, id, data) {
  const existing = await findVisibleTask(user, id);

  if (!isManager(user)) {
    // Members may edit tasks they created, but on tasks assigned to them by someone else
    // they can only move the status.
    const onlyStatus = Object.keys(data).every((k) => k === 'status');
    if (existing.creatorId !== user.id && !onlyStatus) {
      throw ApiError.forbidden('You can only change the status of tasks assigned to you');
    }
  }
  if (data.assigneeId !== undefined && data.assigneeId !== existing.assigneeId) {
    await assertAssignable(user, data.assigneeId);
  }

  const dueChanged = data.dueDate !== undefined && String(data.dueDate) !== String(existing.dueDate);
  // completedAt tracks the moment a task reached DONE; reopening clears it.
  const statusChanged = data.status !== undefined && data.status !== existing.status;
  const completion = statusChanged ? { completedAt: data.status === 'DONE' ? new Date() : null } : {};
  const task = await prisma.task.update({
    where: { id },
    data: { ...data, ...completion, ...(dueChanged && { reminderSentAt: null }) },
    include: taskInclude,
  });
  await scheduleTaskReminder(task);
  await afterWrite('task:updated', task, [existing.assigneeId]);
  return task;
}

export async function deleteTask(user, id) {
  const existing = await findVisibleTask(user, id);
  if (!isManager(user) && existing.creatorId !== user.id) {
    throw ApiError.forbidden('Only the creator or a manager can delete this task');
  }
  await prisma.task.delete({ where: { id } });
  await cancelTaskReminder(id);
  await afterWrite('task:deleted', { id, creatorId: existing.creatorId, assigneeId: existing.assigneeId });
}

export async function getStats(user) {
  const version = await namespaceVersion(CACHE_NS);
  const scope = isManager(user) ? 'all' : user.id;

  return cached(`cache:${CACHE_NS}:${version}:stats:${scope}`, async () => {
    const where = visibilityFilter(user);
    const [byStatus, byPriority, overdue, dueThisWeek] = await Promise.all([
      prisma.task.groupBy({ by: ['status'], where, _count: true }),
      prisma.task.groupBy({ by: ['priority'], where, _count: true }),
      prisma.task.count({ where: { ...where, status: { not: 'DONE' }, dueDate: { lt: new Date() } } }),
      prisma.task.count({
        where: { ...where, status: { not: 'DONE' }, dueDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 86400_000) } },
      }),
    ]);
    const toMap = (rows, k) => Object.fromEntries(rows.map((r) => [r[k], r._count]));
    return { byStatus: toMap(byStatus, 'status'), byPriority: toMap(byPriority, 'priority'), overdue, dueThisWeek };
  });
}

// Tasks due within [from, to) for the calendar. Bounded range (validated at the route) keeps it small.
export async function getCalendar(user, { from, to }) {
  const version = await namespaceVersion(CACHE_NS);
  const scope = isManager(user) ? 'all' : user.id;
  const key = `cache:${CACHE_NS}:${version}:calendar:${scope}:${from.toISOString()}:${to.toISOString()}`;

  return cached(key, () =>
    prisma.task.findMany({
      where: { AND: [visibilityFilter(user), { dueDate: { gte: from, lt: to } }] },
      include: taskInclude,
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
      take: 500,
    }),
  );
}

const DAY_MS = 86400_000;
const dayKey = (d) => d.toISOString().slice(0, 10);

// Aggregates for the analytics page. Daily buckets are UTC days.
export async function getAnalytics(user, { days }) {
  const version = await namespaceVersion(CACHE_NS);
  const scope = isManager(user) ? 'all' : user.id;

  return cached(`cache:${CACHE_NS}:${version}:analytics:${scope}:${days}`, async () => {
    const where = visibilityFilter(user);
    const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
    const since = new Date(today.getTime() - (days - 1) * DAY_MS);

    const [created, completed, workloadRows, openByPriority] = await Promise.all([
      prisma.task.findMany({ where: { ...where, createdAt: { gte: since } }, select: { createdAt: true } }),
      prisma.task.findMany({ where: { ...where, completedAt: { gte: since } }, select: { completedAt: true, createdAt: true } }),
      prisma.task.groupBy({ by: ['assigneeId', 'status'], where, _count: true }),
      prisma.task.groupBy({ by: ['priority'], where: { ...where, status: { not: 'DONE' } }, _count: true }),
    ]);

    // Dense daily series so the chart has an explicit zero for quiet days.
    const series = Array.from({ length: days }, (_, i) => ({ date: dayKey(new Date(since.getTime() + i * DAY_MS)), created: 0, completed: 0 }));
    const index = Object.fromEntries(series.map((d, i) => [d.date, i]));
    created.forEach((t) => { const i = index[dayKey(t.createdAt)]; if (i !== undefined) series[i].created += 1; });
    completed.forEach((t) => { const i = index[dayKey(t.completedAt)]; if (i !== undefined) series[i].completed += 1; });

    const cycleDays = completed.map((t) => (t.completedAt - t.createdAt) / DAY_MS);
    const avgCycleDays = cycleDays.length ? cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length : null;

    // Workload per assignee, broken down by status.
    const assigneeIds = [...new Set(workloadRows.map((r) => r.assigneeId).filter(Boolean))];
    const people = await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true, avatarUrl: true } });
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    const workload = {};
    for (const r of workloadRows) {
      const k = r.assigneeId || 'unassigned';
      workload[k] ??= { user: r.assigneeId ? byId[r.assigneeId] || null : null, TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 };
      workload[k][r.status] = r._count;
    }
    const workloadList = Object.values(workload)
      .map((w) => ({ ...w, open: w.TODO + w.IN_PROGRESS + w.REVIEW }))
      .sort((a, b) => b.open - a.open || (a.user?.name || '').localeCompare(b.user?.name || ''));

    return {
      days,
      series,
      totals: {
        created: created.length,
        completed: completed.length,
        avgCycleDays: avgCycleDays === null ? null : Math.round(avgCycleDays * 10) / 10,
      },
      workload: workloadList,
      openByPriority: Object.fromEntries(openByPriority.map((r) => [r.priority, r._count])),
    };
  });
}
