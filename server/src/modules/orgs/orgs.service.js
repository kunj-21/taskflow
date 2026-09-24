import crypto from 'node:crypto';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/errors.js';
import { invalidateNamespace } from '../../utils/cache.js';
import { atLeast, forgetMembership } from '../../middleware/auth.js';
import { emailQueue } from '../../jobs/queues.js';

const INVITE_TTL_DAYS = 7;
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const userCard = { id: true, name: true, email: true, avatarUrl: true };

export const PLAN_SEATS = { FREE: 5, PRO: 50, ENTERPRISE: 10_000 };

function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
}

async function uniqueSlug(name, tx = prisma) {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${crypto.randomBytes(2).toString('hex')}`;
    if (!(await tx.organization.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  throw ApiError.conflict('Could not allocate an organization slug');
}

// New orgs start with a default project so the board is usable immediately.
export async function createOrganization(userId, name, tx = prisma) {
  const org = await tx.organization.create({
    data: {
      name,
      slug: await uniqueSlug(name, tx),
      seatLimit: PLAN_SEATS.FREE,
      memberships: { create: { userId, role: 'OWNER' } },
      projects: { create: { name: 'General', key: 'GEN' } },
    },
  });
  return org;
}

export async function listMyOrganizations(userId) {
  const rows = await prisma.membership.findMany({
    where: { userId },
    select: { role: true, org: { select: { id: true, name: true, slug: true, plan: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ ...r.org, role: r.role }));
}

export async function seatUsage(orgId) {
  const [members, pendingInvites] = await Promise.all([
    prisma.membership.count({ where: { orgId } }),
    prisma.invitation.count({ where: { orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return { members, pendingInvites, used: members + pendingInvites };
}

export async function getOrganization(org) {
  const full = await prisma.organization.findUnique({ where: { id: org.id } });
  return { ...full, seats: { ...(await seatUsage(org.id)), limit: full.seatLimit } };
}

export async function renameOrganization(orgId, name) {
  return prisma.organization.update({ where: { id: orgId }, data: { name } });
}

/* ---------------- Members ---------------- */

export function listMembers(orgId, search) {
  return prisma.membership.findMany({
    where: {
      orgId,
      ...(search && { user: { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } }),
    },
    select: { role: true, createdAt: true, user: { select: userCard } },
    orderBy: { user: { name: 'asc' } },
    take: 500,
  });
}

async function ownerCount(orgId) {
  return prisma.membership.count({ where: { orgId, role: 'OWNER' } });
}

async function getMembership(orgId, userId) {
  const m = await prisma.membership.findUnique({ where: { userId_orgId: { userId, orgId } }, include: { user: { select: userCard } } });
  if (!m) throw ApiError.notFound('Member not found');
  return m;
}

// Rules: nobody changes their own role; only owners grant or revoke OWNER; the last owner stays an owner.
export async function changeMemberRole(actor, orgId, targetUserId, role) {
  if (targetUserId === actor.userId) throw ApiError.badRequest('You cannot change your own role');
  const target = await getMembership(orgId, targetUserId);
  if ((role === 'OWNER' || target.role === 'OWNER') && actor.role !== 'OWNER') {
    throw ApiError.forbidden('Only owners can grant or remove the owner role');
  }
  if (target.role === 'OWNER' && role !== 'OWNER' && (await ownerCount(orgId)) <= 1) {
    throw ApiError.badRequest('An organization must keep at least one owner');
  }
  const updated = await prisma.membership.update({
    where: { id: target.id }, data: { role }, select: { role: true, createdAt: true, user: { select: userCard } },
  });
  await forgetMembership(orgId, targetUserId);
  await invalidateNamespace(`org:${orgId}`);
  return { before: target.role, member: updated };
}

// Removing someone from an org keeps their tasks (history matters); their assignments are cleared.
export async function removeMember(actor, orgId, targetUserId) {
  const target = await getMembership(orgId, targetUserId);
  const self = targetUserId === actor.userId;
  if (!self && !atLeast(actor.role, 'ADMIN')) throw ApiError.forbidden('Requires admin role or higher');
  if (!self && target.role === 'OWNER' && actor.role !== 'OWNER') throw ApiError.forbidden('Only owners can remove an owner');
  if (target.role === 'OWNER' && (await ownerCount(orgId)) <= 1) {
    throw ApiError.badRequest('Transfer ownership before the last owner leaves');
  }
  await prisma.$transaction([
    prisma.task.updateMany({ where: { orgId, assigneeId: targetUserId }, data: { assigneeId: null } }),
    prisma.membership.delete({ where: { id: target.id } }),
  ]);
  await forgetMembership(orgId, targetUserId);
  await Promise.all([invalidateNamespace(`org:${orgId}`), invalidateNamespace(`tasks:${orgId}`)]);
  return target;
}

/* ---------------- Invitations ---------------- */

export function listInvitations(orgId) {
  return prisma.invitation.findMany({
    where: { orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true, invitedBy: { select: userCard } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createInvitation(actor, org, { email, role }) {
  if (role === 'OWNER' && actor.role !== 'OWNER') throw ApiError.forbidden('Only owners can invite owners');

  const existingMember = await prisma.membership.findFirst({ where: { orgId: org.id, user: { email } }, select: { id: true } });
  if (existingMember) throw ApiError.conflict(`${email} is already a member`);

  const { used } = await seatUsage(org.id);
  const seatLimit = (await prisma.organization.findUnique({ where: { id: org.id }, select: { seatLimit: true } })).seatLimit;
  // Re-inviting the same email replaces the old invite, so it doesn't need a new seat.
  const pending = await prisma.invitation.findFirst({ where: { orgId: org.id, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (!pending && used >= seatLimit) {
    throw new ApiError(402, `Seat limit reached (${seatLimit}). Upgrade your plan to invite more people.`);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const invitation = await prisma.$transaction(async (tx) => {
    if (pending) await tx.invitation.update({ where: { id: pending.id }, data: { revokedAt: new Date() } });
    return tx.invitation.create({
      data: {
        orgId: org.id, email, role, invitedById: actor.userId,
        tokenHash: hash(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000),
      },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
  });

  const link = `${env.CLIENT_URL}/invite/${token}`;
  await emailQueue?.add('send', {
    to: email,
    subject: `You're invited to join ${org.name} on TaskFlow`,
    text: `${actor.name} invited you to join ${org.name} on TaskFlow as ${role.toLowerCase()}.\n\nAccept the invitation: ${link}\n\nThis link expires in ${INVITE_TTL_DAYS} days.`,
  });
  // The raw token is returned once so admins can copy the link (useful before SMTP is configured).
  return { invitation, link };
}

export async function revokeInvitation(orgId, id) {
  const inv = await prisma.invitation.findFirst({ where: { id, orgId, acceptedAt: null, revokedAt: null } });
  if (!inv) throw ApiError.notFound('Invitation not found');
  return prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
}

async function findUsableInvite(token, tx = prisma) {
  const inv = await tx.invitation.findUnique({
    where: { tokenHash: hash(token) },
    include: { org: { select: { id: true, name: true, slug: true } }, invitedBy: { select: { name: true } } },
  });
  if (!inv || inv.revokedAt) throw ApiError.notFound('This invitation is no longer valid');
  if (inv.acceptedAt) throw ApiError.conflict('This invitation has already been used');
  if (inv.expiresAt < new Date()) throw new ApiError(410, 'This invitation has expired. Ask for a new one.');
  return inv;
}

export async function previewInvitation(token) {
  const inv = await findUsableInvite(token);
  return { email: inv.email, role: inv.role, org: inv.org, invitedBy: inv.invitedBy?.name ?? null, expiresAt: inv.expiresAt };
}

// The invite is bound to an email address: only the account with that email can accept it.
export async function acceptInvitation(token, user, tx = prisma) {
  const inv = await findUsableInvite(token, tx);
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw ApiError.forbidden(`This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
  }
  await tx.membership.upsert({
    where: { userId_orgId: { userId: user.id, orgId: inv.orgId } },
    update: {},
    create: { userId: user.id, orgId: inv.orgId, role: inv.role },
  });
  await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
  await forgetMembership(inv.orgId, user.id);
  await invalidateNamespace(`org:${inv.orgId}`);
  return inv;
}
