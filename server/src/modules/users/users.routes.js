import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ApiError } from '../../utils/errors.js';
import { cached, invalidateNamespace, namespaceVersion } from '../../utils/cache.js';

const router = Router();
router.use(authenticate);

const userSelect = { id: true, email: true, name: true, avatarUrl: true, role: true, createdAt: true };

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users (for assignee pickers and admin screens)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Users, content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/User' } } } } }
 */
router.get(
  '/',
  validate({ query: z.object({ search: z.string().trim().max(100).optional() }) }),
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const version = await namespaceVersion('users');
    const users = await cached(`cache:users:${version}:list:${search || ''}`, () =>
      prisma.user.findMany({
        where: search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
          : {},
        select: userSelect,
        orderBy: { name: 'asc' },
        take: 100,
      }),
    );
    res.json(users);
  }),
);

/**
 * @openapi
 * /users/{id}/role:
 *   patch:
 *     tags: [Users]
 *     summary: Change a user's role (admin only)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, properties: { role: { type: string, enum: [ADMIN, MANAGER, MEMBER] } } } } }
 *     responses:
 *       200: { description: Updated user }
 *       403: { description: Not an admin }
 */
router.patch(
  '/:id/role',
  authorize('ADMIN'),
  validate({ body: z.object({ role: z.enum(['ADMIN', 'MANAGER', 'MEMBER']) }) }),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id && req.body.role !== 'ADMIN') {
      throw ApiError.badRequest('Admins cannot demote themselves');
    }
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { role: req.body.role }, select: userSelect });
    await invalidateNamespace('users');
    res.json(user);
  }),
);

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Delete a user (admin only)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       204: { description: Deleted }
 */
router.delete('/:id', authorize('ADMIN'), asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw ApiError.badRequest('Admins cannot delete themselves');
  await prisma.user.delete({ where: { id: req.params.id } });
  await Promise.all([invalidateNamespace('users'), invalidateNamespace('tasks')]);
  res.status(204).end();
}));

export default router;
