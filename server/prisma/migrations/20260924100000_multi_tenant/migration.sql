-- Multi-tenancy: organizations, memberships (per-org roles), invitations, projects, audit log.
-- Existing single-tenant data is moved into a "Default organization" so nothing is lost.

-- Enums
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER');
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- New tables
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "seatLimit" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" TEXT NOT NULL,
    "invitedById" TEXT,
    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "taskCounter" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Backfill: one default org + "General" project, only if there is existing data.
INSERT INTO "Organization" ("id", "name", "slug", "updatedAt")
SELECT 'org_default', 'Default organization', 'default', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "User");

-- Map old global roles to org roles; the earliest admin becomes the owner.
INSERT INTO "Membership" ("id", "role", "createdAt", "userId", "orgId")
SELECT
    'mem_' || u."id",
    CASE
        WHEN u."role" = 'ADMIN' AND u."id" = (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" LIMIT 1) THEN 'OWNER'::"OrgRole"
        WHEN u."role" = 'ADMIN' THEN 'ADMIN'::"OrgRole"
        WHEN u."role" = 'MANAGER' THEN 'MANAGER'::"OrgRole"
        ELSE 'MEMBER'::"OrgRole"
    END,
    u."createdAt", u."id", 'org_default'
FROM "User" u
WHERE EXISTS (SELECT 1 FROM "Organization" WHERE "id" = 'org_default');

-- If there were users but no admin at all, promote the earliest user to owner.
UPDATE "Membership" SET "role" = 'OWNER'
WHERE "id" = (SELECT "id" FROM "Membership" WHERE "orgId" = 'org_default' ORDER BY "createdAt" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "Membership" WHERE "orgId" = 'org_default' AND "role" = 'OWNER');

-- Seat limit must cover everyone already in the default org.
UPDATE "Organization" SET "seatLimit" = GREATEST(5, (SELECT COUNT(*) FROM "Membership" WHERE "orgId" = 'org_default'))
WHERE "id" = 'org_default';

INSERT INTO "Project" ("id", "name", "key", "orgId", "updatedAt")
SELECT 'proj_general', 'General', 'GEN', 'org_default', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Task");

-- Tasks: add columns nullable, backfill, then enforce NOT NULL.
ALTER TABLE "Task" ADD COLUMN "number" INTEGER, ADD COLUMN "orgId" TEXT, ADD COLUMN "projectId" TEXT;

UPDATE "Task" t SET "orgId" = 'org_default', "projectId" = 'proj_general', "number" = n.rn
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn FROM "Task") n
WHERE t."id" = n."id";

UPDATE "Project" SET "taskCounter" = (SELECT COUNT(*) FROM "Task" WHERE "projectId" = 'proj_general')
WHERE "id" = 'proj_general';

ALTER TABLE "Task" ALTER COLUMN "number" SET NOT NULL, ALTER COLUMN "orgId" SET NOT NULL, ALTER COLUMN "projectId" SET NOT NULL;

-- Roles now live on Membership.
ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "Role";

-- Indexes: task indexes are now org-scoped.
DROP INDEX "Task_assigneeId_status_idx";
DROP INDEX "Task_completedAt_idx";
DROP INDEX "Task_createdAt_idx";
DROP INDEX "Task_dueDate_idx";

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Membership_orgId_role_idx" ON "Membership"("orgId", "role");
CREATE UNIQUE INDEX "Membership_userId_orgId_key" ON "Membership"("userId", "orgId");
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX "Invitation_orgId_email_idx" ON "Invitation"("orgId", "email");
CREATE INDEX "Project_orgId_archivedAt_idx" ON "Project"("orgId", "archivedAt");
CREATE UNIQUE INDEX "Project_orgId_key_key" ON "Project"("orgId", "key");
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");
CREATE INDEX "AuditLog_orgId_action_idx" ON "AuditLog"("orgId", "action");
CREATE INDEX "Task_orgId_status_idx" ON "Task"("orgId", "status");
CREATE INDEX "Task_orgId_assigneeId_status_idx" ON "Task"("orgId", "assigneeId", "status");
CREATE INDEX "Task_orgId_dueDate_idx" ON "Task"("orgId", "dueDate");
CREATE INDEX "Task_orgId_createdAt_idx" ON "Task"("orgId", "createdAt");
CREATE INDEX "Task_orgId_completedAt_idx" ON "Task"("orgId", "completedAt");
CREATE UNIQUE INDEX "Task_projectId_number_key" ON "Task"("projectId", "number");

-- Foreign keys
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
