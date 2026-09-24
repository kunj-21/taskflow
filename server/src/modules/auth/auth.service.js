import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/errors.js';

export const REFRESH_COOKIE = 'tf_refresh';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const publicUser = ({ passwordHash, googleId, ...u }) => u;

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

// Refresh tokens are opaque random strings; only their hash is stored so a DB leak can't be replayed.
async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86400_000);
  await prisma.refreshToken.create({ data: { tokenHash: hash(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function issueSession(user) {
  const accessToken = signAccessToken(user);
  const refresh = await issueRefreshToken(user.id);
  return { accessToken, refresh, user: publicUser(user) };
}

// Rotation: each refresh token is single-use. Reuse of a revoked token revokes the whole family.
export async function rotateRefreshToken(token) {
  if (!token) throw ApiError.unauthorized('Missing refresh token');
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
  if (!record) throw ApiError.unauthorized('Invalid refresh token');

  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw ApiError.unauthorized('Refresh token reuse detected');
  }
  if (record.expiresAt < new Date()) throw ApiError.unauthorized('Refresh token expired');

  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  return issueSession(record.user);
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  await prisma.refreshToken.updateMany({ where: { tokenHash: hash(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function register({ email, name, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw ApiError.conflict('Email already registered');
  // First user becomes admin so a fresh deployment is manageable.
  const isFirst = (await prisma.user.count()) === 0;
  const user = await prisma.user.create({
    data: { email, name, passwordHash: await bcrypt.hash(password, 12), role: isFirst ? 'ADMIN' : 'MEMBER' },
  });
  return issueSession(user);
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  return issueSession(user);
}

export async function upsertGoogleUser(profile) {
  const email = profile.emails?.[0]?.value;
  if (!email) throw ApiError.badRequest('Google account has no email');
  const avatarUrl = profile.photos?.[0]?.value;

  const byGoogle = await prisma.user.findUnique({ where: { googleId: profile.id } });
  if (byGoogle) return byGoogle;

  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    return prisma.user.update({ where: { id: byEmail.id }, data: { googleId: profile.id, avatarUrl: byEmail.avatarUrl || avatarUrl } });
  }

  const isFirst = (await prisma.user.count()) === 0;
  return prisma.user.create({
    data: { email, name: profile.displayName || email, googleId: profile.id, avatarUrl, role: isFirst ? 'ADMIN' : 'MEMBER' },
  });
}
