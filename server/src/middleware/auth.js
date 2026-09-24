import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/db.js';
import { redis } from '../config/redis.js';
import { ApiError } from '../utils/errors.js';

// Access tokens identify the person only. Roles are per organization and resolved per request.
export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized('Missing access token'));

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired access token'));
  }
}

export const ROLE_RANK = { MEMBER: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };
export const atLeast = (role, min) => ROLE_RANK[role] >= ROLE_RANK[min];
export const isManager = (membership) => atLeast(membership.role, 'MANAGER');

const MEMBERSHIP_TTL = 60;
export const membershipCacheKey = (orgId, userId) => `membership:${orgId}:${userId}`;

export async function forgetMembership(orgId, userId) {
  await redis.del(membershipCacheKey(orgId, userId)).catch(() => {});
}

async function loadMembership(orgId, userId) {
  const key = membershipCacheKey(orgId, userId);
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit);
  } catch { /* fall through to the database */ }

  const m = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { role: true, org: { select: { id: true, name: true, slug: true, plan: true, seatLimit: true } } },
  });
  const value = m ? { role: m.role, org: m.org } : null;
  redis.set(key, JSON.stringify(value), 'EX', MEMBERSHIP_TTL).catch(() => {});
  return value;
}

// Tenant boundary: every org-scoped route runs this. The org comes from the X-Org-Id header and
// the caller must be a member of it. Non-members get 404 (not 403) so org ids can't be probed.
export async function requireOrg(req, _res, next) {
  try {
    const orgId = req.headers['x-org-id'];
    if (!orgId || typeof orgId !== 'string') throw ApiError.badRequest('Missing X-Org-Id header');
    const m = await loadMembership(orgId, req.user.id);
    if (!m) throw ApiError.notFound('Organization not found');
    req.org = m.org;
    req.membership = { role: m.role };
    next();
  } catch (err) {
    next(err);
  }
}

// requireRole('ADMIN') allows ADMIN and OWNER.
export const requireRole = (min) => (req, _res, next) => {
  if (!req.membership) return next(ApiError.unauthorized());
  if (!atLeast(req.membership.role, min)) return next(ApiError.forbidden(`Requires ${min.toLowerCase()} role or higher`));
  next();
};
