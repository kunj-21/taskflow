import { Queue } from 'bullmq';
import { createRedis } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const connection = env.isTest ? null : createRedis();
const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

const makeQueue = (name) => (connection ? new Queue(name, { connection, defaultJobOptions }) : null);

export const QUEUES = { EMAIL: 'email', REMINDERS: 'reminders', REPORTS: 'reports' };
export const emailQueue = makeQueue(QUEUES.EMAIL);
export const reminderQueue = makeQueue(QUEUES.REMINDERS);
export const reportsQueue = makeQueue(QUEUES.REPORTS);

const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

// One delayed job per task, keyed by task id so rescheduling replaces the old job.
export async function scheduleTaskReminder(task) {
  if (!reminderQueue) return;
  const jobId = `reminder-${task.id}`;
  try {
    await reminderQueue.remove(jobId);
    if (!task.dueDate || !task.assigneeId || task.status === 'DONE') return;
    const delay = Math.max(0, new Date(task.dueDate).getTime() - REMINDER_LEAD_MS - Date.now());
    await reminderQueue.add('task-reminder', { taskId: task.id }, { jobId, delay });
  } catch (err) {
    logger.warn('Failed to schedule reminder', { taskId: task.id, err: err.message });
  }
}

export async function cancelTaskReminder(taskId) {
  await reminderQueue?.remove(`reminder-${taskId}`).catch(() => {});
}
