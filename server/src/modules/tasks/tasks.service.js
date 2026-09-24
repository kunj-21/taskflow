import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/errors.js';
import { cached, namespaceVersion, invalidateNamespace } from '../../utils/cache.js';
import { isManager } from '../../middleware/auth.js';
import { emitTaskEvent } from '../../sockets/index.js';
import { scheduleTaskReminder, cancelTaskReminder } from '../../jobs/queues.js';

// Every function takes a request context { user, org, membership } from requireOrg.
// Every query is filtered by ctx.org.id: that filter is the tenant boundary.

const ns = (ctx) => `tasks:${ctx.org.id}`;
const scopeKey = (ctx) => (isManager(ctx.membership) ? 'all' : ctx.user.id);

const taskInclude = {
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  creator: { select: { id: true, name: true, email: true, avatarUrl: true } },
  project: { select: { id: true, name: true, key: true } },
};

// Members only see tasks they created or are assigned to; managers and above see the whole org.
function baseWhere(ctx) {
  const where = { orgId: ctx.org.id };
  if (!isManager(ctx.membership)) where.OR = [{ creatorId: ctx.user.id }, { assigneeId: ctx.user.id }];
  return where;
}

async function cacheKey(ctx, ...parts) {
  const version = await namespaceVersion(ns(ctx));
  return `cache:${ns(ctx)}:${version}:${scopeKey(ctx)}:${parts.join(':')}`;
}

export async function listTasks(ctx, q) {
  const where = {
    AND: [
      baseWhere(ctx),
      q.projectId ? { projectId: q.projectId } : {},
      q.status ? { status: q.status } : {},
      q.priority ? { priority: q.priority } : {},
      q.assigneeId ? { assigneeId: q.assigneeId === 'me' ? ctx.user.id : q.assigneeId } : {},
      q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] } : {},
      q.dueBefore ? { dueDate: { lte: q.dueBefore } } : {},
      q.dueAfter ? { dueDate: { gte: q.dueAfter } } : {},
    ],
  };

  return cached(await cacheKey(ctx, 'list', JSON.stringify(q)), async () => {
    const [items, total] = await prisma.$transaction([
      prisma.task.findMany({ where, include: taskInclude, orderBy: [{ [q.sortBy]: q.order }, { id: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit }),
      prisma.task.count({ where }),
    ]);
    return { items, page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
  });
}

async function findVisibleTask(ctx, id) {
  const task = await prisma.task.findFirst({ where: { id, ...baseWhere(ctx) }, include: taskInclude });
  if (!task) throw ApiError.notFound('Task not found');
  return task;
}

export const getTask = findVisibleTask;

async function assertAssignable(ctx, assigneeId) {
  if (!assigneeId) return;
  if (!isManager(ctx.membership) && assigneeId !== ctx.user.id) {
    throw ApiError.forbidden('Only managers and above can assign tasks to other people');
  }
  const member = await prisma.membership.findUnique({ where: { userId_orgId: { userId: assigneeId, orgId: ctx.org.id } }, select: { id: true } });
  if (!member) throw ApiError.badRequest('Assignee is not a member of this organization');
}

async function assertProject(ctx, projectId) {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId: ctx.org.id }, select: { id: true, archivedAt: true } });
  if (!project) throw ApiError.badRequest('Project does not exist in this organization');
  if (project.archivedAt) throw ApiError.badRequest('Project is archived');
}

async function afterWrite(ctx, event, task, extraUserIds) {
  await invalidateNamespace(ns(ctx));
  emitTaskEvent(ctx.org.id, event, task, extraUserIds);
}

export async function createTask(ctx, data) {
  const assigneeId = data.assigneeId === undefined ? ctx.user.id : data.assigneeId;
  await Promise.all([assertAssignable(ctx, assigneeId), assertProject(ctx, data.projectId)]);

  // Per-project sequential numbers (WEB-1, WEB-2...). The counter increment and insert share a
  // transaction, and the row lock on the project serializes concurrent creates.
  const task = await prisma.$transaction(async (tx) => {
    const { taskCounter } = await tx.project.update({ where: { id: data.projectId }, data: { taskCounter: { increment: 1 } }, select: { taskCounter: true } });
    return tx.task.create({
      data: {
        ...data, assigneeId, number: taskCounter, orgId: ctx.org.id, creatorId: ctx.user.id,
        completedAt: data.status === 'DONE' ? new Date() : null,
      },
      include: taskInclude,
    });
  });
  await scheduleTaskReminder(task);
  await afterWrite(ctx, 'task:created', task);
  return task;
}

export async function updateTask(ctx, id, data) {
  const existing = await findVisibleTask(ctx, id);

  if (!isManager(ctx.membership)) {
    // Members may edit tasks they created; on tasks assigned by someone else they only move status.
    const onlyStatus = Object.keys(data).every((k) => k === 'status');
    if (existing.creatorId !== ctx.user.id && !onlyStatus) {
      throw ApiError.forbidden('You can only change the status of tasks assigned to you');
    }
  }
  if (data.assigneeId !== undefined && data.assigneeId !== existing.assigneeId) await assertAssignable(ctx, data.assigneeId);
  if (data.projectId && data.projectId !== existing.projectId) {
    // Moving projects would break the task's number, so it isn't supported; recreate instead.
    throw ApiError.badRequest('Tasks cannot be moved between projects');
  }

  const dueChanged = data.dueDate !== undefined && String(data.dueDate) !== String(existing.dueDate);
  const statusChanged = data.status !== undefined && data.status !== existing.status;
  const completion = statusChanged ? { completedAt: data.status === 'DONE' ? new Date() : null } : {};
  const task = await prisma.task.update({
    where: { id },
    data: { ...data, ...completion, ...(dueChanged && { reminderSentAt: null }) },
    include: taskInclude,
  });
  await scheduleTaskReminder(task);
  await afterWrite(ctx, 'task:updated', task, [existing.assigneeId]);
  return task;
}

export async function deleteTask(ctx, id) {
  const existing = await findVisibleTask(ctx, id);
  if (!isManager(ctx.membership) && existing.creatorId !== ctx.user.id) {
    throw ApiError.forbidden('Only the creator or a manager can delete this task');
  }
  await prisma.task.delete({ where: { id } });
  await cancelTaskReminder(id);
  await afterWrite(ctx, 'task:deleted', { id, creatorId: existing.creatorId, assigneeId: existing.assigneeId });
  return existing;
}

const withProject = (where, projectId) => (projectId ? { ...where, projectId } : where);

export async function getStats(ctx, { projectId } = {}) {
  return cached(await cacheKey(ctx, 'stats', projectId || '-'), async () => {
    const where = withProject(baseWhere(ctx), projectId);
    const [byStatus, byPriority, overdue, dueThisWeek] = await Promise.all([
      prisma.task.groupBy({ by: ['status'], where, _count: true }),
      prisma.task.groupBy({ by: ['priority'], where, _count: true }),
      prisma.task.count({ where: { ...where, status: { not: 'DONE' }, dueDate: { lt: new Date() } } }),
      prisma.task.count({ where: { ...where, status: { not: 'DONE' }, dueDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 86400_000) } } }),
    ]);
    const toMap = (rows, k) => Object.fromEntries(rows.map((r) => [r[k], r._count]));
    return { byStatus: toMap(byStatus, 'status'), byPriority: toMap(byPriority, 'priority'), overdue, dueThisWeek };
  });
}

// Tasks due within [from, to) for the calendar. The route caps the range.
export async function getCalendar(ctx, { from, to, projectId }) {
  return cached(await cacheKey(ctx, 'calendar', from.toISOString(), to.toISOString(), projectId || '-'), () =>
    prisma.task.findMany({
      where: { ...withProject(baseWhere(ctx), projectId), dueDate: { gte: from, lt: to } },
      include: taskInclude,
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
      take: 500,
    }),
  );
}

const DAY_MS = 86400_000;
const dayKey = (d) => d.toISOString().slice(0, 10);

// Aggregates for the analytics page. Daily buckets are UTC days.
export async function getAnalytics(ctx, { days, projectId }) {
  return cached(await cacheKey(ctx, 'analytics', days, projectId || '-'), async () => {
    const where = withProject(baseWhere(ctx), projectId);
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
