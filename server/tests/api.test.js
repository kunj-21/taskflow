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

  it('restricts role changes to admins', async () => {
    const res = await request(app).patch(`/api/v1/users/${other.user.id}/role`).set(as(member)).send({ role: 'ADMIN' });
    expect(res.status).toBe(403);
    const ok = await request(app).patch(`/api/v1/users/${other.user.id}/role`).set(as(admin)).send({ role: 'MANAGER' });
    expect(ok.body.role).toBe('MANAGER');
  });
});
