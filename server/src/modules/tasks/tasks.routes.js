import { Router } from 'express';
import { authenticate, requireOrg } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/errors.js';
import * as tasks from './tasks.service.js';
import { audit } from '../audit/audit.service.js';
import { createTaskSchema, updateTaskSchema, listTasksSchema, idParam, calendarSchema, analyticsSchema, statsSchema } from './tasks.schemas.js';

const router = Router();
router.use(authenticate, requireOrg);

/**
 * @openapi
 * /tasks:
 *   get:
 *     tags: [Tasks]
 *     summary: List tasks visible to the current user (paginated, filterable, cached)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: query, name: projectId, schema: { type: string } }
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
  res.json(await tasks.listTasks(req, req.query));
}));

router.post('/', validate({ body: createTaskSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await tasks.createTask(req, req.body));
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
router.get('/stats', validate({ query: statsSchema }), asyncHandler(async (req, res) => {
  res.json(await tasks.getStats(req, req.query));
}));

/**
 * @openapi
 * /tasks/calendar:
 *   get:
 *     tags: [Tasks]
 *     summary: Tasks due within a date range (max 62 days), for the calendar view
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: query, name: from, required: true, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, required: true, schema: { type: string, format: date-time }, description: Exclusive upper bound }
 *     responses:
 *       200: { description: Tasks, content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Task' } } } } }
 *       400: { description: Invalid or too-large range }
 */
router.get('/calendar', validate({ query: calendarSchema }), asyncHandler(async (req, res) => {
  res.json(await tasks.getCalendar(req, req.query));
}));

/**
 * @openapi
 * /tasks/analytics:
 *   get:
 *     tags: [Tasks]
 *     summary: Daily created/completed series, cycle time, workload per assignee, open tasks by priority
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: header, name: X-Org-Id, required: true, schema: { type: string } }
 *       - { in: query, name: days, schema: { type: integer, enum: [7, 30, 90], default: 30 } }
 *     responses:
 *       200: { description: Analytics payload }
 */
router.get('/analytics', validate({ query: analyticsSchema }), asyncHandler(async (req, res) => {
  res.json(await tasks.getAnalytics(req, req.query));
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
  res.json(await tasks.getTask(req, req.params.id));
}));

router.patch('/:id', validate({ params: idParam, body: updateTaskSchema }), asyncHandler(async (req, res) => {
  res.json(await tasks.updateTask(req, req.params.id, req.body));
}));

router.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const task = await tasks.deleteTask(req, req.params.id);
  await audit(req, { action: 'task.deleted', entityType: 'task', entityId: task.id, metadata: { key: `${task.project.key}-${task.number}`, title: task.title } });
  res.status(204).end();
}));

export default router;
