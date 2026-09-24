// Integration tests: run against a real Postgres (taskflow_test DB) and Redis.
// Start infra with `docker compose up -d postgres redis`, then `npm test`.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { execSync } from 'node:child_process';
import { prisma } from '../src/config/db.js';
import { redis } from '../src/config/redis.js';
import { createApp } from '../src/app.js';

const app = createApp();
const api = '/api/v1';

// Session helper: token + current org header.
const as = (who, orgId = who.orgId) => ({ Authorization: `Bearer ${who.token}`, ...(orgId && { 'X-Org-Id': orgId }) });

async function signup(email, name, extra = {}) {
  const res = await request(app).post(`${api}/auth/register`).send({ email, name, password: 'password123', ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.accessToken, user: res.body.user, orgs: res.body.organizations, orgId: res.body.organizations[0]?.id, cookie: res.headers['set-cookie'] };
}

async function invite(by, email, role = 'MEMBER') {
  const res = await request(app).post(`${api}/org/invitations`).set(as(by)).send({ email, role });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.link.split('/invite/')[1];
}

const firstProject = async (who) => (await request(app).get(`${api}/projects`).set(as(who))).body[0];

let owner;   // Acme owner
let member;  // Acme member (joined by invite)
let manager; // Acme manager (joined by invite)
let rival;   // owner of a different org (Globex)
let acmeProject;
let rivalProject;

beforeAll(async () => {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { env: process.env, stdio: 'ignore' });
  await redis.connect().catch(() => {});
  await redis.flushdb();

  owner = await signup('owner@acme.test', 'Olive Owner', { orgName: 'Acme Corp' });
  rival = await signup('boss@globex.test', 'Gus Globex', { orgName: 'Globex Inc' });

  member = await signup('member@acme.test', 'Mo Member', { inviteToken: await invite(owner, 'member@acme.test', 'MEMBER') });
  manager = await signup('manager@acme.test', 'Mara Manager', { inviteToken: await invite(owner, 'manager@acme.test', 'MANAGER') });

  acmeProject = await firstProject(owner);
  rivalProject = await firstProject(rival);
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe('sign-up and sessions', () => {
  it('creates an organization with the new user as owner and a default project', () => {
    expect(owner.orgs).toEqual([expect.objectContaining({ name: 'Acme Corp', role: 'OWNER' })]);
    expect(acmeProject).toMatchObject({ key: 'GEN', name: 'General' });
  });

  it('joins the inviting organization with the invited role', () => {
    expect(member.orgs).toEqual([expect.objectContaining({ id: owner.orgId, role: 'MEMBER' })]);
    expect(manager.orgs[0].role).toBe('MANAGER');
  });

  it('requires an organization name when not joining by invite', async () => {
    const res = await request(app).post(`${api}/auth/register`).send({ email: 'x@y.test', name: 'X', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('rejects bad credentials', async () => {
    expect((await request(app).post(`${api}/auth/login`).send({ email: 'owner@acme.test', password: 'nope' })).status).toBe(401);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const first = await request(app).post(`${api}/auth/refresh`).set('Cookie', owner.cookie);
    expect(first.status).toBe(200);
    expect(first.body.organizations[0].role).toBe('OWNER');
    expect((await request(app).post(`${api}/auth/refresh`).set('Cookie', owner.cookie).then((r) => r.status))).toBe(401);
  });
});

describe('tenant isolation', () => {
  let acmeTask;

  beforeAll(async () => {
    acmeTask = (await request(app).post(`${api}/tasks`).set(as(owner)).send({ title: 'Acme secret', projectId: acmeProject.id })).body;
  });

  it('requires an org header on org-scoped routes', async () => {
    expect((await request(app).get(`${api}/tasks`).set(as(owner, null))).status).toBe(400);
  });

  it('treats a non-member org id as not found', async () => {
    expect((await request(app).get(`${api}/tasks`).set(as(rival, owner.orgId))).status).toBe(404);
    expect((await request(app).get(`${api}/org/members`).set(as(rival, owner.orgId))).status).toBe(404);
  });

  it('never returns another org’s tasks, even by id', async () => {
    const list = await request(app).get(`${api}/tasks`).set(as(rival));
    expect(list.body.items.map((t) => t.title)).not.toContain('Acme secret');
    expect((await request(app).get(`${api}/tasks/${acmeTask.id}`).set(as(rival))).status).toBe(404);
    expect((await request(app).patch(`${api}/tasks/${acmeTask.id}`).set(as(rival)).send({ title: 'pwned' })).status).toBe(404);
    expect((await request(app).delete(`${api}/tasks/${acmeTask.id}`).set(as(rival))).status).toBe(404);
  });

  it('refuses to create tasks in another org’s project or assign non-members', async () => {
    expect((await request(app).post(`${api}/tasks`).set(as(rival)).send({ title: 'x', projectId: acmeProject.id })).status).toBe(400);
    const res = await request(app).post(`${api}/tasks`).set(as(owner)).send({ title: 'x', projectId: acmeProject.id, assigneeId: rival.user.id });
    expect(res.status).toBe(400);
  });

  it('scopes calendar, analytics and stats to the org', async () => {
    const due = new Date(Date.UTC(2031, 4, 15, 12));
    await request(app).post(`${api}/tasks`).set(as(rival)).send({ title: 'Globex only', projectId: rivalProject.id, dueDate: due });
    const cal = await request(app).get(`${api}/tasks/calendar?from=2031-05-01T00:00:00Z&to=2031-06-01T00:00:00Z`).set(as(owner));
    expect(cal.body.map((t) => t.title)).not.toContain('Globex only');
    const rivalStats = await request(app).get(`${api}/tasks/stats`).set(as(rival));
    expect(Object.values(rivalStats.body.byStatus).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('tasks, projects and roles within an org', () => {
  let taskId;

  it('numbers tasks sequentially per project', async () => {
    const a = (await request(app).post(`${api}/tasks`).set(as(manager)).send({ title: 'One', projectId: acmeProject.id, assigneeId: member.user.id })).body;
    const b = (await request(app).post(`${api}/tasks`).set(as(manager)).send({ title: 'Two', projectId: acmeProject.id })).body;
    expect(b.number).toBe(a.number + 1);
    expect(a.project.key).toBe('GEN');
    taskId = a.id;
  });

  it('forbids members from assigning tasks to others', async () => {
    const res = await request(app).post(`${api}/tasks`).set(as(member)).send({ title: 'x', projectId: acmeProject.id, assigneeId: owner.user.id });
    expect(res.status).toBe(403);
  });

  it('lets the assignee change status but not the title', async () => {
    expect((await request(app).patch(`${api}/tasks/${taskId}`).set(as(member)).send({ status: 'DONE' })).status).toBe(200);
    expect((await request(app).patch(`${api}/tasks/${taskId}`).set(as(member)).send({ title: 'hacked' })).status).toBe(403);
  });

  it('stamps completedAt on DONE and clears it on reopen', async () => {
    const t = (await request(app).get(`${api}/tasks/${taskId}`).set(as(owner))).body;
    expect(t.completedAt).not.toBeNull();
    const reopened = await request(app).patch(`${api}/tasks/${taskId}`).set(as(owner)).send({ status: 'IN_PROGRESS' });
    expect(reopened.body.completedAt).toBeNull();
  });

  it('only lets managers and above create projects; keys are unique per org', async () => {
    expect((await request(app).post(`${api}/projects`).set(as(member)).send({ name: 'Web', key: 'WEB' })).status).toBe(403);
    const web = await request(app).post(`${api}/projects`).set(as(manager)).send({ name: 'Website', key: 'web' });
    expect(web.status).toBe(201);
    expect(web.body.key).toBe('WEB');
    expect((await request(app).post(`${api}/projects`).set(as(manager)).send({ name: 'Dup', key: 'WEB' })).status).toBe(409);
    // Same key in a different org is fine.
    expect((await request(app).post(`${api}/projects`).set(as(rival)).send({ name: 'Web', key: 'WEB' })).status).toBe(201);
  });

  it('blocks new tasks in archived projects', async () => {
    const p = (await request(app).post(`${api}/projects`).set(as(owner)).send({ name: 'Old', key: 'OLD' })).body;
    await request(app).patch(`${api}/projects/${p.id}`).set(as(owner)).send({ archived: true });
    expect((await request(app).post(`${api}/tasks`).set(as(owner)).send({ title: 'x', projectId: p.id })).status).toBe(400);
  });

  it('rejects oversized calendar ranges and invalid analytics windows', async () => {
    expect((await request(app).get(`${api}/tasks/calendar?from=2031-01-01&to=2031-06-01`).set(as(owner))).status).toBe(400);
    expect((await request(app).get(`${api}/tasks/analytics?days=12`).set(as(owner))).status).toBe(400);
  });

  it('builds a dense analytics series whose totals add up', async () => {
    const res = await request(app).get(`${api}/tasks/analytics?days=7`).set(as(owner));
    expect(res.body.series).toHaveLength(7);
    expect(res.body.series.reduce((a, d) => a + d.created, 0)).toBe(res.body.totals.created);
  });
});

describe('membership administration', () => {
  it('lets admins change roles but not their own', async () => {
    const res = await request(app).patch(`${api}/org/members/${member.user.id}`).set(as(owner)).send({ role: 'MANAGER' });
    expect(res.body.role).toBe('MANAGER');
    await request(app).patch(`${api}/org/members/${member.user.id}`).set(as(owner)).send({ role: 'MEMBER' });
    expect((await request(app).patch(`${api}/org/members/${owner.user.id}`).set(as(owner)).send({ role: 'ADMIN' })).status).toBe(400);
  });

  it('applies role changes immediately (membership cache is invalidated)', async () => {
    await request(app).patch(`${api}/org/members/${manager.user.id}`).set(as(owner)).send({ role: 'MEMBER' });
    expect((await request(app).post(`${api}/projects`).set(as(manager)).send({ name: 'Nope', key: 'NOPE' })).status).toBe(403);
    await request(app).patch(`${api}/org/members/${manager.user.id}`).set(as(owner)).send({ role: 'MANAGER' });
  });

  it('reserves the owner role for owners and protects the last owner', async () => {
    await request(app).patch(`${api}/org/members/${manager.user.id}`).set(as(owner)).send({ role: 'ADMIN' });
    const admin = manager;
    expect((await request(app).patch(`${api}/org/members/${member.user.id}`).set(as(admin)).send({ role: 'OWNER' })).status).toBe(403);
    expect((await request(app).delete(`${api}/org/members/${owner.user.id}`).set(as(owner))).status).toBe(400);
    await request(app).patch(`${api}/org/members/${manager.user.id}`).set(as(owner)).send({ role: 'MANAGER' });
  });

  it('keeps a removed member’s tasks but unassigns them', async () => {
    const extra = await signup('temp@acme.test', 'Tem Porary', { inviteToken: await invite(owner, 'temp@acme.test') });
    const t = (await request(app).post(`${api}/tasks`).set(as(owner)).send({ title: 'Handover', projectId: acmeProject.id, assigneeId: extra.user.id })).body;
    expect((await request(app).delete(`${api}/org/members/${extra.user.id}`).set(as(owner))).status).toBe(204);
    const after = (await request(app).get(`${api}/tasks/${t.id}`).set(as(owner))).body;
    expect(after.assigneeId).toBeNull();
    expect((await request(app).get(`${api}/tasks`).set(as(extra, owner.orgId))).status).toBe(404);
  });

  it('keeps members out of admin-only areas', async () => {
    expect((await request(app).get(`${api}/org/audit`).set(as(member))).status).toBe(403);
    expect((await request(app).get(`${api}/org/invitations`).set(as(member))).status).toBe(403);
    expect((await request(app).post(`${api}/org/invitations`).set(as(member)).send({ email: 'z@z.test' })).status).toBe(403);
  });
});

describe('invitations and seats', () => {
  it('binds an invitation to its email address', async () => {
    const token = await invite(owner, 'invitee@acme.test');
    const preview = await request(app).get(`${api}/invitations/${token}`);
    expect(preview.body).toMatchObject({ email: 'invitee@acme.test', role: 'MEMBER', org: { name: 'Acme Corp' } });
    expect((await request(app).post(`${api}/invitations/${token}/accept`).set(as(rival, null))).status).toBe(403);
    const other = await request(app).post(`${api}/auth/register`).send({ email: 'someone@else.test', name: 'S', password: 'password123', inviteToken: token });
    expect(other.status).toBe(403);
    // The failed sign-up rolled back: that email is still free.
    expect(await prisma.user.findUnique({ where: { email: 'someone@else.test' } })).toBeNull();
  });

  it('lets an existing user accept an invite to a second org', async () => {
    const token = await invite(rival, 'member@acme.test', 'MEMBER');
    const res = await request(app).post(`${api}/invitations/${token}/accept`).set(as(member, null));
    expect(res.status).toBe(200);
    const orgs = (await request(app).get(`${api}/orgs`).set(as(member, null))).body;
    expect(orgs.map((o) => o.name).sort()).toEqual(['Acme Corp', 'Globex Inc']);
    expect((await request(app).post(`${api}/invitations/${token}/accept`).set(as(member, null))).status).toBe(409);
  });

  it('enforces the seat limit, counting pending invitations', async () => {
    const { members, used, limit } = await request(app).get(`${api}/org`).set(as(owner)).then((r) => ({ ...r.body.seats }));
    expect(used).toBeGreaterThanOrEqual(members);
    for (let i = used; i < limit; i++) await invite(owner, `fill${i}@acme.test`);
    const res = await request(app).post(`${api}/org/invitations`).set(as(owner)).send({ email: 'one-too-many@acme.test' });
    expect(res.status).toBe(402);
    // Revoking a pending invite frees its seat.
    const pending = (await request(app).get(`${api}/org/invitations`).set(as(owner))).body;
    await request(app).delete(`${api}/org/invitations/${pending[0].id}`).set(as(owner));
    expect((await request(app).post(`${api}/org/invitations`).set(as(owner)).send({ email: 'one-too-many@acme.test' })).status).toBe(201);
  });
});

describe('audit log', () => {
  it('records security-relevant actions with the actor', async () => {
    const res = await request(app).get(`${api}/org/audit?limit=100`).set(as(owner));
    const actions = res.body.items.map((e) => e.action);
    for (const a of ['org.created', 'member.invited', 'member.joined', 'member.role_changed', 'member.removed', 'project.created', 'project.archived', 'invitation.revoked']) {
      expect(actions).toContain(a);
    }
    const roleChange = res.body.items.find((e) => e.action === 'member.role_changed');
    expect(roleChange.actor.email).toBe('owner@acme.test');
    expect(roleChange.metadata).toMatchObject({ from: expect.any(String), to: expect.any(String) });
  });

  it('never shows one org’s audit events to another', async () => {
    const rivalLog = await request(app).get(`${api}/org/audit?limit=100`).set(as(rival));
    expect(rivalLog.body.items.every((e) => e.orgId === rival.orgId)).toBe(true);
  });
});
