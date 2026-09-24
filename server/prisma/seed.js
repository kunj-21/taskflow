import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const users = [
  { email: 'admin@taskflow.dev', name: 'Ada Admin', role: 'ADMIN' },
  { email: 'manager@taskflow.dev', name: 'Max Manager', role: 'MANAGER' },
  { email: 'member@taskflow.dev', name: 'Mia Member', role: 'MEMBER' },
];

const passwordHash = await bcrypt.hash('password123', 12);
const created = {};
for (const u of users) {
  created[u.role] = await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash } });
}

if ((await prisma.task.count()) === 0) {
  const day = 86400_000;
  await prisma.task.createMany({
    data: [
      { title: 'Set up CI pipeline', priority: 'HIGH', status: 'IN_PROGRESS', dueDate: new Date(Date.now() + 2 * day), creatorId: created.MANAGER.id, assigneeId: created.MEMBER.id },
      { title: 'Write API docs', priority: 'MEDIUM', status: 'TODO', dueDate: new Date(Date.now() + 5 * day), creatorId: created.MANAGER.id, assigneeId: created.MEMBER.id },
      { title: 'Review Q3 roadmap', priority: 'URGENT', status: 'REVIEW', dueDate: new Date(Date.now() + day), creatorId: created.ADMIN.id, assigneeId: created.MANAGER.id },
      { title: 'Fix login redirect bug', priority: 'HIGH', status: 'DONE', creatorId: created.MEMBER.id, assigneeId: created.MEMBER.id },
      { title: 'Plan team offsite', priority: 'LOW', status: 'TODO', dueDate: new Date(Date.now() - day), creatorId: created.ADMIN.id, assigneeId: created.ADMIN.id },
    ],
  });
}

// ~60 days of history so the analytics charts have a real shape. Deterministic PRNG keeps
// reseeds reproducible; only runs on a near-empty database so it never piles up.
if ((await prisma.task.count()) < 10) {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const topics = ['Update onboarding docs', 'Fix flaky payment test', 'Design settings page', 'Migrate cron jobs', 'Customer interview notes',
    'Audit API rate limits', 'Refactor auth middleware', 'Prepare sprint demo', 'Tune Postgres indexes', 'Write release notes',
    'Triage support tickets', 'Add CSV export', 'Improve empty states', 'Review pull requests', 'Load-test WebSocket server'];
  const people = [created.ADMIN, created.MANAGER, created.MEMBER];
  const day = 86400_000;
  const history = [];

  for (let d = 60; d >= 1; d--) {
    const perDay = Math.floor(rand() * 3) + (d % 7 < 5 ? 1 : 0); // quieter "weekends"
    for (let i = 0; i < perDay; i++) {
      const createdAt = new Date(Date.now() - d * day + Math.floor(rand() * 8) * 3600_000);
      const assignee = pick(people);
      const roll = rand();
      // Older tasks are more likely finished.
      const status = roll < 0.55 + (d / 60) * 0.35 ? 'DONE' : pick(['TODO', 'IN_PROGRESS', 'REVIEW']);
      const completedAt = status === 'DONE' ? new Date(Math.min(Date.now() - 3600_000, createdAt.getTime() + (0.5 + rand() * 6) * day)) : null;
      history.push({
        title: pick(topics),
        priority: pick(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'URGENT']),
        status,
        createdAt,
        completedAt,
        dueDate: new Date(createdAt.getTime() + (2 + Math.floor(rand() * 12)) * day),
        creatorId: assignee.role === 'MEMBER' && rand() < 0.5 ? assignee.id : created.MANAGER.id,
        assigneeId: assignee.id,
      });
    }
  }
  await prisma.task.createMany({ data: history });
  console.log(`Seeded ${history.length} historical tasks for analytics`);
}

console.log('Seeded users (password: password123):', users.map((u) => u.email).join(', '));
await prisma.$disconnect();
