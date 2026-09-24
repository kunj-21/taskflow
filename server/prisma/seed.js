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

console.log('Seeded users (password: password123):', users.map((u) => u.email).join(', '));
await prisma.$disconnect();
