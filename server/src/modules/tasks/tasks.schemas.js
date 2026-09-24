import { z } from 'zod';

export const STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
};

export const createTaskSchema = z.object(taskFields);

export const updateTaskSchema = z
  .object({ ...taskFields, title: taskFields.title.optional() })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const listTasksSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().optional(),
  search: z.string().trim().max(100).optional(),
  dueBefore: z.coerce.date().optional(),
  dueAfter: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'dueDate', 'priority', 'title']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const idParam = z.object({ id: z.string().min(1) });

const MAX_CALENDAR_DAYS = 62;
export const calendarSchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((v) => v.to > v.from, { message: '`to` must be after `from`', path: ['to'] })
  .refine((v) => v.to - v.from <= MAX_CALENDAR_DAYS * 86400_000, { message: `Range can be at most ${MAX_CALENDAR_DAYS} days`, path: ['to'] });

export const analyticsSchema = z.object({
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'days must be 7, 30 or 90').default(30),
});
