import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrg, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/errors.js';
import { prisma } from '../../config/db.js';
import { audit, listAudit } from '../audit/audit.service.js';
import * as orgs from './orgs.service.js';

const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'];
const orgName = z.string().trim().min(2).max(80);
const actorOf = async (req) => ({
  userId: req.user.id,
  role: req.membership.role,
  name: (await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } }))?.name ?? 'A teammate',
});

/* ---------- /orgs : the caller's organizations (no org context needed) ---------- */
export const orgsRouter = Router();
orgsRouter.use(authenticate);

/**
 * @openapi
 * /orgs:
 *   get:
 *     tags: [Organizations]
 *     summary: Organizations the current user belongs to, with their role in each
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Organizations }
 *   post:
 *     tags: [Organizations]
 *     summary: Create a new organization (caller becomes owner)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [name], properties: { name: { type: string } } } } }
 *     responses:
 *       201: { description: Created organization }
 */
orgsRouter.get('/', asyncHandler(async (req, res) => {
  res.json(await orgs.listMyOrganizations(req.user.id));
}));

orgsRouter.post('/', validate({ body: z.object({ name: orgName }) }), asyncHandler(async (req, res) => {
  const org = await orgs.createOrganization(req.user.id, req.body.name);
  await audit(req, { orgId: org.id, action: 'org.created', entityType: 'organization', entityId: org.id, metadata: { name: org.name } });
  res.status(201).json({ ...org, role: 'OWNER' });
}));

/* ---------- /invitations/:token : public preview + authenticated accept ---------- */
export const invitationsRouter = Router();

/**
 * @openapi
 * /invitations/{token}:
 *   get:
 *     tags: [Organizations]
 *     summary: Preview an invitation (public)
 *     parameters: [{ in: path, name: token, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Org name, invited email and role }
 *       404: { description: Invalid or revoked }
 *       410: { description: Expired }
 * /invitations/{token}/accept:
 *   post:
 *     tags: [Organizations]
 *     summary: Accept an invitation. The signed-in user's email must match the invite.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: token, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Joined; returns the organization }
 *       403: { description: Signed in with a different email }
 */
invitationsRouter.get('/:token', asyncHandler(async (req, res) => {
  res.json(await orgs.previewInvitation(req.params.token));
}));

invitationsRouter.post('/:token/accept', authenticate, asyncHandler(async (req, res) => {
  const inv = await prisma.$transaction((tx) => orgs.acceptInvitation(req.params.token, req.user, tx));
  await audit(req, { orgId: inv.orgId, action: 'member.joined', entityType: 'user', entityId: req.user.id, metadata: { email: inv.email, role: inv.role } });
  res.json({ ...inv.org, role: inv.role });
}));

/* ---------- /org : the current organization (X-Org-Id) ---------- */
export const orgRouter = Router();
orgRouter.use(authenticate, requireOrg);

/**
 * @openapi
 * /org:
 *   get:
 *     tags: [Organizations]
 *     summary: Current organization with plan and seat usage
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: header, name: X-Org-Id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Organization }
 *   patch:
 *     tags: [Organizations]
 *     summary: Rename the organization (admin+)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: header, name: X-Org-Id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Updated }
 */
orgRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ ...(await orgs.getOrganization(req.org)), role: req.membership.role });
}));

orgRouter.patch('/', requireRole('ADMIN'), validate({ body: z.object({ name: orgName }) }), asyncHandler(async (req, res) => {
  const org = await orgs.renameOrganization(req.org.id, req.body.name);
  await audit(req, { action: 'org.renamed', entityType: 'organization', entityId: org.id, metadata: { from: req.org.name, to: org.name } });
  res.json(org);
}));

/**
 * @openapi
 * /org/members:
 *   get:
 *     tags: [Organizations]
 *     summary: Members of the current organization
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Members }
 * /org/members/{userId}:
 *   patch:
 *     tags: [Organizations]
 *     summary: Change a member's role (admin+; only owners manage the owner role)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated member }
 *   delete:
 *     tags: [Organizations]
 *     summary: Remove a member (admin+), or leave the organization (self)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Removed }
 */
orgRouter.get('/members', validate({ query: z.object({ search: z.string().trim().max(100).optional() }) }), asyncHandler(async (req, res) => {
  const rows = await orgs.listMembers(req.org.id, req.query.search);
  res.json(rows.map((m) => ({ ...m.user, role: m.role, joinedAt: m.createdAt })));
}));

orgRouter.patch('/members/:userId', requireRole('ADMIN'), validate({ body: z.object({ role: z.enum(ROLES) }) }), asyncHandler(async (req, res) => {
  const { before, member } = await orgs.changeMemberRole(await actorOf(req), req.org.id, req.params.userId, req.body.role);
  await audit(req, { action: 'member.role_changed', entityType: 'user', entityId: req.params.userId, metadata: { email: member.user.email, from: before, to: member.role } });
  res.json({ ...member.user, role: member.role, joinedAt: member.createdAt });
}));

orgRouter.delete('/members/:userId', asyncHandler(async (req, res) => {
  const removed = await orgs.removeMember(await actorOf(req), req.org.id, req.params.userId);
  const self = req.params.userId === req.user.id;
  await audit(req, { action: self ? 'member.left' : 'member.removed', entityType: 'user', entityId: req.params.userId, metadata: { email: removed.user.email, role: removed.role } });
  res.status(204).end();
}));

/**
 * @openapi
 * /org/invitations:
 *   get:
 *     tags: [Organizations]
 *     summary: Pending invitations (admin+)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: header, name: X-Org-Id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Invitations }
 *   post:
 *     tags: [Organizations]
 *     summary: Invite someone by email (admin+). Counts toward the seat limit.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: header, name: X-Org-Id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [email], properties: { email: { type: string }, role: { type: string, enum: [OWNER, ADMIN, MANAGER, MEMBER] } } } } }
 *     responses:
 *       201: { description: Invitation created; response includes the invite link }
 *       402: { description: Seat limit reached }
 * /org/invitations/{id}:
 *   delete:
 *     tags: [Organizations]
 *     summary: Revoke a pending invitation (admin+)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Revoked }
 */
orgRouter.get('/invitations', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  res.json(await orgs.listInvitations(req.org.id));
}));

orgRouter.post(
  '/invitations',
  requireRole('ADMIN'),
  validate({ body: z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ROLES).default('MEMBER') }) }),
  asyncHandler(async (req, res) => {
    const result = await orgs.createInvitation(await actorOf(req), req.org, req.body);
    await audit(req, { action: 'member.invited', entityType: 'invitation', entityId: result.invitation.id, metadata: { email: req.body.email, role: req.body.role } });
    res.status(201).json(result);
  }),
);

orgRouter.delete('/invitations/:id', requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const inv = await orgs.revokeInvitation(req.org.id, req.params.id);
  await audit(req, { action: 'invitation.revoked', entityType: 'invitation', entityId: inv.id, metadata: { email: inv.email } });
  res.status(204).end();
}));

/**
 * @openapi
 * /org/audit:
 *   get:
 *     tags: [Organizations]
 *     summary: Audit log (admin+), newest first
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 100 } }
 *       - { in: query, name: action, schema: { type: string }, description: "Prefix filter, e.g. 'member.' or 'task.deleted'" }
 *       - { in: query, name: actorId, schema: { type: string } }
 *     responses:
 *       200: { description: Page of audit events }
 */
orgRouter.get(
  '/audit',
  requireRole('ADMIN'),
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      action: z.string().trim().max(60).optional(),
      actorId: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await listAudit(req.org.id, req.query));
  }),
);
