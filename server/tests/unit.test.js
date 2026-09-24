// Unit tests: no database or Redis required.
import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticate, requireRole, atLeast } from '../src/middleware/auth.js';
import { validate } from '../src/middleware/validate.js';
import { listTasksSchema, updateTaskSchema } from '../src/modules/tasks/tasks.schemas.js';

const token = () => jwt.sign({ sub: 'u1', email: 'a@b.c' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '1m' });
const run = (mw, req) => new Promise((resolve) => mw(req, {}, resolve));

describe('authenticate', () => {
  it('attaches the user for a valid token', async () => {
    const req = { headers: { authorization: `Bearer ${token()}` } };
    expect(await run(authenticate, req)).toBeUndefined();
    expect(req.user).toEqual({ id: 'u1', email: 'a@b.c' });
  });

  it('rejects missing and tampered tokens', async () => {
    expect((await run(authenticate, { headers: {} })).status).toBe(401);
    const bad = jwt.sign({ sub: 'u1', role: 'ADMIN' }, 'wrong-secret-wrong-secret-wrong-secret');
    expect((await run(authenticate, { headers: { authorization: `Bearer ${bad}` } })).status).toBe(401);
  });
});

describe('org roles (RBAC)', () => {
  it('ranks roles owner > admin > manager > member', () => {
    expect(atLeast('OWNER', 'ADMIN')).toBe(true);
    expect(atLeast('ADMIN', 'MANAGER')).toBe(true);
    expect(atLeast('MANAGER', 'ADMIN')).toBe(false);
    expect(atLeast('MEMBER', 'MANAGER')).toBe(false);
  });

  it('requireRole allows the minimum role and above', async () => {
    const mw = requireRole('MANAGER');
    expect(await run(mw, { membership: { role: 'OWNER' } })).toBeUndefined();
    expect(await run(mw, { membership: { role: 'MANAGER' } })).toBeUndefined();
    expect((await run(mw, { membership: { role: 'MEMBER' } })).status).toBe(403);
    expect((await run(mw, {})).status).toBe(401);
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
