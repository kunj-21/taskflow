import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/errors.js';
import * as tasks from './tasks.service.js';
import { createTaskSchema, updateTaskSchema, listTasksSchema, idParam } from './tasks.schemas.js';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * /tasks:
 *   get:
 *     tags: [Tasks]
 *     summary: List tasks visible to the current user (paginated, filterable, cached)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: status, schema: { type: string, enum: [TODO, IN_PROGRESS, REVIEW, DONE] } }
 *       - { in: query, name: priority, schema: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] } }
 *       - { in: query, name: assigneeId, schema: { type: string }, description: "User id or 'me'" }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: dueBefore, schema: { type: string, format: date-time } }
 *       - { in: query, name: dueAfter, schema: { type: string, format: date-time } }
 *       - { in: query, name: sortBy, schema: { type: string, enum: [createdAt, updatedAt, dueDate, priority, title] } }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc] } }
 *     responses:
 *       200: { description: Page of tasks, content: { application/json: { schema: { $ref: '#/components/schemas/TaskPage' } } } }
 *   post:
 *     tags: [Tasks]
 *     summary: Create a task. Members can only assign to themselves.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/TaskInput' } } }
 *     responses:
 *       201: { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/Task' } } } }
 *       403: { description: Not allowed to assign to that user }
 */
router.get('/', validate({ query: listTasksSchema }), asyncHandler(async (req, res) => {
  res.json(await tasks.listTasks(req.user, req.query));
}));

router.post('/', validate({ body: createTaskSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await tasks.createTask(req.user, req.body));
}));

/**
 * @openapi
 * /tasks/stats:
 *   get:
 *     tags: [Tasks]
 *     summary: Aggregate counts for the dashboard
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Stats }
 */
router.get('/stats', asyncHandler(async (req, res) => {
  res.json(await tasks.getStats(req.user));
}));

/**
 * @openapi
 * /tasks/{id}:
 *   get:
 *     tags: [Tasks]
 *     summary: Get one task
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Task, content: { application/json: { schema: { $ref: '#/components/schemas/Task' } } } }
 *       404: { description: Not found or not visible }
 *   patch:
 *     tags: [Tasks]
 *     summary: Update a task. Members can only change status on tasks assigned to them.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/TaskInput' } } }
 *     responses:
 *       200: { description: Updated }
 *       403: { description: Forbidden }
 *   delete:
 *     tags: [Tasks]
 *     summary: Delete a task (creator, manager, or admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       204: { description: Deleted }
 */
router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  res.json(await tasks.getTask(req.user, req.params.id));
}));

router.patch('/:id', validate({ params: idParam, body: updateTaskSchema }), asyncHandler(async (req, res) => {
  res.json(await tasks.updateTask(req.user, req.params.id, req.body));
}));

router.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  await tasks.deleteTask(req.user, req.params.id);
  res.status(204).end();
}));

export default router;
