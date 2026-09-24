import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { authenticate, requireOrg, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ApiError } from '../../utils/errors.js';
import { cached, invalidateNamespace, namespaceVersion } from '../../utils/cache.js';
import { audit } from '../audit/audit.service.js';

const router = Router();
router.use(authenticate, requireOrg);

const key = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Key must be 2–6 letters or digits, starting with a letter');
const projectSelect = { id: true, name: true, key: true, description: true, archivedAt: true, createdAt: true, _count: { select: { tasks: true } } };
const ns = (orgId) => `projects:${orgId}`;

/**
 * @openapi
 * /projects:
 *   get:
 *     tags: [Projects]
 *     summary: Projects in the current organization
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: query, name: includeArchived, schema: { type: boolean } }
 *     responses:
 *       200: { description: Projects }
 *   post:
 *     tags: [Projects]
 *     summary: Create a project (manager+)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: header, name: X-Org-Id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [name, key], properties: { name: { type: string }, key: { type: string, example: WEB }, description: { type: string } } } } }
 *     responses:
 *       201: { description: Created }
 *       409: { description: Key already used in this organization }
 */
router.get('/', validate({ query: z.object({ includeArchived: z.enum(['true', 'false']).optional() }) }), asyncHandler(async (req, res) => {
  const all = req.query.includeArchived === 'true';
  const version = await namespaceVersion(ns(req.org.id));
  const projects = await cached(`cache:${ns(req.org.id)}:${version}:${all}`, () =>
    prisma.project.findMany({
      where: { orgId: req.org.id, ...(!all && { archivedAt: null }) },
      select: projectSelect,
      orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }],
    }),
  );
  res.json(projects.map(({ _count, ...p }) => ({ ...p, taskCount: _count.tasks })));
}));

router.post(
  '/',
  requireRole('MANAGER'),
  validate({ body: z.object({ name: z.string().trim().min(1).max(80), key, description: z.string().trim().max(1000).nullish() }) }),
  asyncHandler(async (req, res) => {
    const project = await prisma.project.create({ data: { ...req.body, orgId: req.org.id }, select: projectSelect });
    await invalidateNamespace(ns(req.org.id));
    await audit(req, { action: 'project.created', entityType: 'project', entityId: project.id, metadata: { name: project.name, key: project.key } });
    const { _count, ...p } = project;
    res.status(201).json({ ...p, taskCount: _count.tasks });
  }),
);

/**
 * @openapi
 * /projects/{id}:
 *   patch:
 *     tags: [Projects]
 *     summary: Rename, re-describe, archive or restore a project (manager+). The key cannot change.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 */
router.patch(
  '/:id',
  requireRole('MANAGER'),
  validate({ body: z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(1000).nullish(), archived: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.project.findFirst({ where: { id: req.params.id, orgId: req.org.id } });
    if (!existing) throw ApiError.notFound('Project not found');
    const { archived, ...rest } = req.body;
    const project = await prisma.project.update({
      where: { id: existing.id },
      data: { ...rest, ...(archived !== undefined && { archivedAt: archived ? new Date() : null }) },
      select: projectSelect,
    });
    await invalidateNamespace(ns(req.org.id));
    if (archived !== undefined && Boolean(existing.archivedAt) !== archived) {
      await audit(req, { action: archived ? 'project.archived' : 'project.restored', entityType: 'project', entityId: project.id, metadata: { name: project.name } });
    }
    const { _count, ...p } = project;
    res.json({ ...p, taskCount: _count.tasks });
  }),
);

export default router;
