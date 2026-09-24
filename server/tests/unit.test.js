// Unit tests: no database or Redis required.
import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticate, authorize } from '../src/middleware/auth.js';
import { validate } from '../src/middleware/validate.js';
import { listTasksSchema, updateTaskSchema } from '../src/modules/tasks/tasks.schemas.js';

const token = (role) => jwt.sign({ sub: 'u1', role, email: 'a@b.c' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '1m' });
const run = (mw, req) => new Promise((resolve) => mw(req, {}, resolve));

describe('authenticate', () => {
  it('attaches the user for a valid token', async () => {
    const req = { headers: { authorization: `Bearer ${token('MEMBER')}` } };
    expect(await run(authenticate, req)).toBeUndefined();
    expect(req.user).toMatchObject({ id: 'u1', role: 'MEMBER' });
  });

  it('rejects missing and tampered tokens', async () => {
    expect((await run(authenticate, { headers: {} })).status).toBe(401);
    const bad = jwt.sign({ sub: 'u1', role: 'ADMIN' }, 'wrong-secret-wrong-secret-wrong-secret');
    expect((await run(authenticate, { headers: { authorization: `Bearer ${bad}` } })).status).toBe(401);
  });
});

describe('authorize (RBAC)', () => {
  it('allows listed roles and forbids others', async () => {
    const mw = authorize('ADMIN', 'MANAGER');
    expect(await run(mw, { user: { role: 'MANAGER' } })).toBeUndefined();
    expect((await run(mw, { user: { role: 'MEMBER' } })).status).toBe(403);
  });
});

describe('task query validation', () => {
  it('applies pagination defaults and coerces types', () => {
    const q = listTasksSchema.parse({ page: '2', limit: '10' });
    expect(q).toMatchObject({ page: 2, limit: 10, sortBy: 'createdAt', order: 'desc' });
  });

  it('caps the page size', () => {
    expect(listTasksSchema.safeParse({ limit: '1000' }).success).toBe(false);
  });

  it('rejects empty updates', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
  });

  it('validate() returns 400 with field details', async () => {
    const next = vi.fn();
    validate({ query: listTasksSchema })({ query: { status: 'NOPE' } }, {}, next);
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(400);
    expect(err.details).toHaveProperty('status');
  });
});
