// Integration tests: run against a real Postgres (taskflow_test DB) and Redis.
// Start infra with `docker compose up -d postgres redis`, then `npm test`.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { execSync } from 'node:child_process';
import { prisma } from '../src/config/db.js';
import { redis } from '../src/config/redis.js';
import { createApp } from '../src/app.js';

const app = createApp();
let admin, member, other;

async function signup(email, name) {
  const res = await request(app).post('/api/v1/auth/register').send({ email, name, password: 'password123' });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, user: res.body.user, cookie: res.headers['set-cookie'] };
}

const as = (who) => ({ Authorization: `Bearer ${who.token}` });

beforeAll(async () => {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { env: process.env, stdio: 'ignore' });
  await redis.connect().catch(() => {});
  await redis.flushdb();
  admin = await signup('admin@test.dev', 'Admin'); // first user becomes ADMIN
  member = await signup('member@test.dev', 'Member');
  other = await signup('other@test.dev', 'Other');
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe('auth', () => {
  it('makes the first user an admin and later users members', () => {
    expect(admin.user.role).toBe('ADMIN');
    expect(member.user.role).toBe('MEMBER');
  });

  it('rejects bad credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@test.dev', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const first = await request(app).post('/api/v1/auth/refresh').set('Cookie', admin.cookie);
    expect(first.status).toBe(200);
    const reused = await request(app).post('/api/v1/auth/refresh').set('Cookie', admin.cookie);
    expect(reused.status).toBe(401);
  });
});

describe('tasks + RBAC', () => {
  let taskId;

  it('lets an admin assign a task to a member', async () => {
    const res = await request(app).post('/api/v1/tasks').set(as(admin))
      .send({ title: 'Ship it', priority: 'HIGH', assigneeId: member.user.id });
    expect(res.status).toBe(201);
    expect(res.body.assignee.id).toBe(member.user.id);
    taskId = res.body.id;
  });

  it('forbids members from assigning tasks to others', async () => {
    const res = await request(app).post('/api/v1/tasks').set(as(member)).send({ title: 'x', assigneeId: other.user.id });
    expect(res.status).toBe(403);
  });

  it('lets the assignee change status but not the title', async () => {
    expect((await request(app).patch(`/api/v1/tasks/${taskId}`).set(as(member)).send({ status: 'DONE' })).status).toBe(200);
    expect((await request(app).patch(`/api/v1/tasks/${taskId}`).set(as(member)).send({ title: 'hacked' })).status).toBe(403);
  });

  it('hides tasks from unrelated members', async () => {
    expect((await request(app).get(`/api/v1/tasks/${taskId}`).set(as(other))).status).toBe(404);
    const list = await request(app).get('/api/v1/tasks').set(as(other));
    expect(list.body.total).toBe(0);
  });

  it('paginates and filters', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/tasks').set(as(member)).send({ title: `Mine ${i}`, priority: i % 2 ? 'LOW' : 'URGENT' });
    }
    const page = await request(app).get('/api/v1/tasks?limit=2&page=2&assigneeId=me').set(as(member));
    expect(page.body).toMatchObject({ page: 2, limit: 2, total: 6, totalPages: 3 });
    const urgent = await request(app).get('/api/v1/tasks?priority=URGENT').set(as(member));
    expect(urgent.body.total).toBe(3);
  });

  it('serves fresh data after writes despite caching', async () => {
    const before = (await request(app).get('/api/v1/tasks').set(as(admin))).body.total;
    await request(app).post('/api/v1/tasks').set(as(admin)).send({ title: 'Cache buster' });
    const after = (await request(app).get('/api/v1/tasks').set(as(admin))).body.total;
    expect(after).toBe(before + 1);
  });

  it('stamps completedAt when a task reaches DONE and clears it on reopen', async () => {
    const t = (await request(app).post('/api/v1/tasks').set(as(admin)).send({ title: 'Finish me' })).body;
    expect(t.completedAt).toBeNull();
    const done = await request(app).patch(`/api/v1/tasks/${t.id}`).set(as(admin)).send({ status: 'DONE' });
    expect(done.body.completedAt).not.toBeNull();
    const reopened = await request(app).patch(`/api/v1/tasks/${t.id}`).set(as(admin)).send({ status: 'IN_PROGRESS' });
    expect(reopened.body.completedAt).toBeNull();
  });

  it('returns tasks due within a calendar range, scoped by visibility', async () => {
    const due = new Date(Date.UTC(2031, 4, 15, 12));
    await request(app).post('/api/v1/tasks').set(as(admin)).send({ title: 'Admin-only calendar task', dueDate: due });
    await request(app).post('/api/v1/tasks').set(as(member)).send({ title: 'Member calendar task', dueDate: due });
    const range = '?from=2031-05-01T00:00:00Z&to=2031-06-01T00:00:00Z';

    const adminView = await request(app).get(`/api/v1/tasks/calendar${range}`).set(as(admin));
    expect(adminView.status).toBe(200);
    expect(adminView.body.map((t) => t.title).sort()).toEqual(['Admin-only calendar task', 'Member calendar task']);

    const otherView = await request(app).get(`/api/v1/tasks/calendar${range}`).set(as(other));
    expect(otherView.body).toEqual([]);

    const outside = await request(app).get('/api/v1/tasks/calendar?from=2031-06-01T00:00:00Z&to=2031-07-01T00:00:00Z').set(as(admin));
    expect(outside.body).toEqual([]);
  });

  it('rejects oversized or inverted calendar ranges', async () => {
    const tooBig = await request(app).get('/api/v1/tasks/calendar?from=2031-01-01&to=2031-06-01').set(as(admin));
    expect(tooBig.status).toBe(400);
    const inverted = await request(app).get('/api/v1/tasks/calendar?from=2031-06-01&to=2031-05-01').set(as(admin));
    expect(inverted.status).toBe(400);
  });

  it('builds a dense daily analytics series with workload and priority breakdowns', async () => {
    const res = await request(app).get('/api/v1/tasks/analytics?days=7').set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(7);
    const sum = (k) => res.body.series.reduce((a, d) => a + d[k], 0);
    expect(sum('created')).toBe(res.body.totals.created);
    expect(sum('completed')).toBe(res.body.totals.completed);
    expect(res.body.totals.completed).toBeGreaterThanOrEqual(1); // 'Ship it' was completed above
    const memberRow = res.body.workload.find((w) => w.user?.id === member.user.id);
    expect(memberRow.open).toBe(memberRow.TODO + memberRow.IN_PROGRESS + memberRow.REVIEW);
    expect((await request(app).get('/api/v1/tasks/analytics?days=12').set(as(admin))).status).toBe(400);
  });

  it('restricts role changes to admins', async () => {
    const res = await request(app).patch(`/api/v1/users/${other.user.id}/role`).set(as(member)).send({ role: 'ADMIN' });
    expect(res.status).toBe(403);
    const ok = await request(app).patch(`/api/v1/users/${other.user.id}/role`).set(as(admin)).send({ role: 'MANAGER' });
    expect(ok.body.role).toBe('MANAGER');
  });
});
