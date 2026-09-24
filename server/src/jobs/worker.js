// Standalone worker process: `npm run worker`. Scale it independently of the API.
import { Worker } from 'bullmq';
import { createRedis } from '../config/redis.js';
import { prisma } from '../config/db.js';
import { logger } from '../config/logger.js';
import { QUEUES, emailQueue, reportsQueue } from './queues.js';
import { sendMail } from './mailer.js';

const connection = createRedis();

const processors = {
  [QUEUES.EMAIL]: async (job) => sendMail(job.data),

  [QUEUES.REMINDERS]: async (job) => {
    const task = await prisma.task.findUnique({ where: { id: job.data.taskId }, include: { assignee: true } });
    if (!task || !task.assignee || task.status === 'DONE' || task.reminderSentAt) return 'skipped';

    await emailQueue.add('send', {
      to: task.assignee.email,
      subject: `Reminder: "${task.title}" is due soon`,
      text: `Hi ${task.assignee.name},\n\n"${task.title}" is due ${task.dueDate.toUTCString()}.\n\n— TaskFlow`,
    });
    await prisma.task.update({ where: { id: task.id }, data: { reminderSentAt: new Date() } });
    return 'sent';
  },

  [QUEUES.REPORTS]: async () => {
    const since = new Date(Date.now() - 7 * 86400_000);
    const [created, completed, overdue, recipients] = await Promise.all([
      prisma.task.count({ where: { createdAt: { gte: since } } }),
      prisma.task.count({ where: { status: 'DONE', updatedAt: { gte: since } } }),
      prisma.task.count({ where: { status: { not: 'DONE' }, dueDate: { lt: new Date() } } }),
      prisma.user.findMany({ where: { role: { in: ['ADMIN', 'MANAGER'] } }, select: { email: true } }),
    ]);
    const text = `Weekly TaskFlow report\n\nCreated: ${created}\nCompleted: ${completed}\nOverdue now: ${overdue}`;
    await emailQueue.addBulk(recipients.map(({ email }) => ({ name: 'send', data: { to: email, subject: 'Your weekly TaskFlow report', text } })));
    return { created, completed, overdue, recipients: recipients.length };
  },
};

const workers = Object.entries(processors).map(([name, fn]) => {
  const w = new Worker(name, fn, { connection, concurrency: 5 });
  w.on('completed', (job, result) => logger.info('Job completed', { queue: name, jobId: job.id, result }));
  w.on('failed', (job, err) => logger.error('Job failed', { queue: name, jobId: job?.id, err: err.message }));
  return w;
});

// Repeatable job: every Monday 09:00 UTC. upsertJobScheduler is idempotent across restarts.
await reportsQueue.upsertJobScheduler('weekly-report', { pattern: '0 9 * * 1', tz: 'UTC' }, { name: 'weekly-report' });

logger.info(`Worker started for queues: ${Object.keys(processors).join(', ')}`);

async function shutdown() {
  logger.info('Worker shutting down');
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
