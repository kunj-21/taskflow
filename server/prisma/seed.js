// Demo data: two separate customer organizations to show tenant isolation.
//   Acme Corp  — admin@ (owner), manager@ (manager), member@ (member); 3 projects, ~60 days of history
//   Globex Inc — globex@ (owner); its own project and tasks, invisible to Acme
// Idempotent: does nothing if any organization already exists.
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

if ((await prisma.organization.count()) > 0) {
  console.log('Organizations already exist; skipping seed.');
  await prisma.$disconnect();
  process.exit(0);
}

const passwordHash = await bcrypt.hash('password123', 12);
const upsertUser = (email, name) => prisma.user.upsert({ where: { email }, update: {}, create: { email, name, passwordHash } });

const admin = await upsertUser('admin@taskflow.dev', 'Ada Admin');
const manager = await upsertUser('manager@taskflow.dev', 'Max Manager');
const member = await upsertUser('member@taskflow.dev', 'Mia Member');
const globexOwner = await upsertUser('globex@taskflow.dev', 'Gina Globex');

const acme = await prisma.organization.create({
  data: {
    name: 'Acme Corp', slug: 'acme', plan: 'PRO', seatLimit: 50,
    memberships: { create: [{ userId: admin.id, role: 'OWNER' }, { userId: manager.id, role: 'MANAGER' }, { userId: member.id, role: 'MEMBER' }] },
  },
});
const globex = await prisma.organization.create({
  data: { name: 'Globex Inc', slug: 'globex', memberships: { create: [{ userId: globexOwner.id, role: 'OWNER' }] } },
});

const makeProject = (org, name, key, description) => prisma.project.create({ data: { orgId: org.id, name, key, description } });
const projects = [
  await makeProject(acme, 'Website', 'WEB', 'Marketing site and customer portal'),
  await makeProject(acme, 'Mobile app', 'MOB', 'iOS and Android apps'),
  await makeProject(acme, 'Operations', 'OPS', 'Infrastructure, security and internal tooling'),
];
const globexProject = await makeProject(globex, 'General', 'GEN', null);

// Deterministic PRNG keeps reseeds reproducible.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const topics = {
  WEB: ['Redesign pricing page', 'Fix checkout redirect', 'Improve Lighthouse score', 'Add SSO login button', 'Write release notes', 'Update onboarding docs', 'Add CSV export'],
  MOB: ['Push notification settings', 'Fix crash on Android 14', 'Offline mode for tasks', 'Dark mode polish', 'App Store screenshots', 'Improve cold start time'],
  OPS: ['Rotate database credentials', 'Tune Postgres indexes', 'Load-test WebSocket server', 'Audit API rate limits', 'Set up on-call rotation', 'Migrate cron jobs'],
};
const people = [admin, manager, member];
const day = 86400_000;
const counters = Object.fromEntries(projects.map((p) => [p.id, 0]));
const tasks = [];

for (let d = 60; d >= 0; d--) {
  const perDay = Math.floor(rand() * 3) + (d % 7 < 5 ? 1 : 0); // quieter "weekends"
  for (let i = 0; i < perDay; i++) {
    const project = pick(projects);
    const createdAt = new Date(Date.now() - d * day - Math.floor(rand() * 8) * 3600_000);
    const assignee = pick(people);
    // Older tasks are more likely finished.
    const status = d > 0 && rand() < 0.5 + (d / 60) * 0.4 ? 'DONE' : pick(['TODO', 'TODO', 'IN_PROGRESS', 'REVIEW']);
    const completedAt = status === 'DONE' ? new Date(Math.min(Date.now() - 3600_000, createdAt.getTime() + (0.5 + rand() * 6) * day)) : null;
    tasks.push({
      orgId: acme.id,
      projectId: project.id,
      number: ++counters[project.id],
      title: pick(topics[project.key]),
      priority: pick(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'URGENT']),
      status,
      createdAt,
      completedAt,
      dueDate: new Date(createdAt.getTime() + (2 + Math.floor(rand() * 12)) * day),
      creatorId: assignee.id === member.id && rand() < 0.5 ? member.id : manager.id,
      assigneeId: assignee.id,
    });
  }
}
await prisma.task.createMany({ data: tasks });
await Promise.all(projects.map((p) => prisma.project.update({ where: { id: p.id }, data: { taskCounter: counters[p.id] } })));

await prisma.task.createMany({
  data: ['Globex quarterly planning', 'Hire a second designer', 'Renew office lease'].map((title, i) => ({
    orgId: globex.id, projectId: globexProject.id, number: i + 1, title, creatorId: globexOwner.id, assigneeId: globexOwner.id,
    dueDate: new Date(Date.now() + (i + 2) * day),
  })),
});
await prisma.project.update({ where: { id: globexProject.id }, data: { taskCounter: 3 } });

await prisma.auditLog.createMany({
  data: [
    { orgId: acme.id, actorId: admin.id, action: 'org.created', entityType: 'organization', entityId: acme.id, metadata: { name: acme.name } },
    ...projects.map((p) => ({ orgId: acme.id, actorId: admin.id, action: 'project.created', entityType: 'project', entityId: p.id, metadata: { name: p.name, key: p.key } })),
    { orgId: globex.id, actorId: globexOwner.id, action: 'org.created', entityType: 'organization', entityId: globex.id, metadata: { name: globex.name } },
  ],
});

console.log(`Seeded Acme Corp (${tasks.length} tasks across ${projects.map((p) => p.key).join(', ')}) and Globex Inc (3 tasks).`);
console.log('Logins (password: password123): admin@, manager@, member@taskflow.dev (Acme) · globex@taskflow.dev (Globex)');
await prisma.$disconnect();
