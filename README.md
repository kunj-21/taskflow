# TaskFlow

A multi-tenant, enterprise-ready task management SaaS: isolated organizations with per-org roles, invitations, projects, seat limits and an audit log, plus OAuth, caching, background jobs, real-time updates and a horizontally scalable deployment.

**Stack:** React · Node.js/Express · PostgreSQL (Prisma) · Redis · BullMQ · Socket.IO · NGINX · Docker

## Features

| Area | What's implemented |
| --- | --- |
| **Auth** | Email/password + Google OAuth 2.0. Short-lived JWT access tokens, rotating refresh tokens in httpOnly cookies, reuse detection that revokes the whole token family. |
| **Multi-tenancy** | Every customer is an isolated **organization**. All work data carries `orgId`; org-scoped routes resolve the caller's membership from the `X-Org-Id` header and return 404 for orgs they don't belong to. Sockets join org-qualified rooms, and cache keys are namespaced per org. People can belong to several orgs and switch between them. |
| **Roles (per org)** | `OWNER` › `ADMIN` › `MANAGER` › `MEMBER`. Managers see all work and assign tasks; members see tasks they created or are assigned. Only owners grant or remove the owner role, nobody changes their own role, and the last owner can't be demoted or leave. |
| **Invitations & seats** | Admins invite by email with a role. Tokens are hashed, bound to the invited email and expire in 7 days. Pending invites count toward the plan's seat limit (402 when full). Sign-up either creates an org or accepts an invite atomically. |
| **Projects** | Tasks belong to projects with per-project numbering (`WEB-42`), assigned under a row lock so concurrent creates never collide. Projects can be archived. |
| **Audit log** | Append-only record of org creation and renames, invites, joins, role changes, removals, project changes and task deletions, with actor, IP and user agent. Admin-only UI with category filters. |
| **Tasks API** | CRUD, pagination, filtering (status, priority, assignee, due range, full-text search), sorting, dashboard stats. |
| **Caching** | Redis cache-aside on task lists, stats and users, with O(1) namespace-version invalidation on writes. |
| **Background jobs** | BullMQ worker (separate process): due-date email reminders scheduled 24h ahead, weekly report emails via a cron scheduler, retries with exponential backoff. |
| **Real-time** | Socket.IO with JWT handshake and per-user / per-role rooms. Redis adapter so events reach clients on any API instance. |
| **Hardening** | Helmet, CORS, Redis-backed rate limiting (shared across instances), zod validation on every input, centralized error handling, request IDs. |
| **Observability** | Winston structured logs (JSON in prod), Morgan HTTP logs with request IDs, `/health` and `/ready` probes. |
| **Docs & tests** | OpenAPI 3 / Swagger UI at `/api/docs`. Vitest unit tests + Supertest integration tests against real Postgres & Redis. GitHub Actions CI. |
| **Frontend** | Org switcher, onboarding and invite-accept flows, kanban board with drag-and-drop and project filter, team and seat management, projects, audit log, settings, dark mode, mobile drawer navigation. |
| **Calendar** | Month grid by due date with drag-to-reschedule, click-a-day to add, and a mobile agenda view. Backed by `GET /tasks/calendar` (bounded ranges). |
| **Analytics** | Created vs. completed trend, workload by person, open tasks by priority, and cycle time. `completedAt` is tracked on every status change. Colour-blind-safe palette checked with a validator; every chart has a table view. |

## Architecture

```
                ┌──────────────┐
  Browser ────▶ │    NGINX     │  static SPA (immutable asset caching)
                │ load balancer│  /api, /socket.io → least_conn upstream
                └──────┬───────┘
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      ┌───────┐    ┌───────┐    ┌───────┐        stateless API replicas
      │ api 1 │    │ api 2 │    │ api N │        (scale with --scale api=N)
      └───┬───┘    └───┬───┘    └───┬───┘
          │   Socket.IO Redis adapter / shared rate limits / cache
          ├────────────┴──────┬─────┘
          ▼                   ▼
   ┌─────────────┐     ┌─────────────┐     ┌──────────┐
   │ PostgreSQL  │     │    Redis    │ ◀── │  worker  │  BullMQ: reminders,
   └─────────────┘     └─────────────┘     └──────────┘  weekly reports, email
```

API instances hold no session state (JWT auth, Redis for everything shared), so they scale horizontally behind the load balancer.

## Quick start

**Prerequisites:** Node 20+, Docker.

```bash
# 1. Infra
docker compose up -d postgres redis

# 2. API
cd server
cp .env.example .env          # then set the two JWT secrets
npm install
npx prisma migrate dev
npm run db:seed               # demo users, password: password123
npm run dev                   # http://localhost:4000

# 3. Worker (separate terminal)
cd server && npm run worker

# 4. Client (separate terminal)
cd client && npm install && npm run dev   # http://localhost:5173
```

Demo data (password `password123`) has two separate organizations:

| Account | Organization | Role |
| --- | --- | --- |
| `admin@taskflow.dev` | Acme Corp | Owner |
| `manager@taskflow.dev` | Acme Corp | Manager |
| `member@taskflow.dev` | Acme Corp | Member |
| `globex@taskflow.dev` | Globex Inc | Owner |

Sign in as Acme and Globex in turn to see tenant isolation in action.

### Full stack in Docker

```bash
cp server/.env.example server/.env   # set JWT secrets
docker compose up --build            # http://localhost:8080
docker compose up -d --scale api=3   # scale API replicas
```

### Google sign-in

Create an OAuth client at [Google Cloud Console](https://console.cloud.google.com/apis/credentials), add `http://localhost:4000/api/v1/auth/google/callback` as a redirect URI, and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `server/.env`. The "Continue with Google" button appears automatically once configured.

## Tests

```bash
docker compose exec postgres psql -U taskflow -c "CREATE DATABASE taskflow_test;"   # once
cd server && npm test
```

## API

Interactive docs at **http://localhost:4000/api/docs**. All paths are under `/api/v1`. Routes marked *org* need an `X-Org-Id` header for an organization the caller belongs to.

| Method | Path | Access |
| --- | --- | --- |
| POST | `/auth/register` (with `orgName` or `inviteToken`), `/auth/login`, `/auth/refresh`, `/auth/logout` | public |
| GET | `/auth/google`, `/invitations/:token` | public |
| GET | `/auth/me`, `/orgs` · POST `/orgs` · POST `/invitations/:token/accept` | authenticated |
| GET/PATCH | `/org` | *org* (rename: admin+) |
| GET | `/org/members` | *org* |
| PATCH/DELETE | `/org/members/:userId` | *org* admin+ (or self to leave) |
| GET/POST/DELETE | `/org/invitations[/:id]` | *org* admin+ |
| GET | `/org/audit` | *org* admin+ |
| GET · POST/PATCH | `/projects` · `/projects/:id` | *org* (write: manager+) |
| GET/POST | `/tasks` (filters incl. `projectId`) | *org*, scoped by role |
| GET | `/tasks/stats`, `/tasks/calendar`, `/tasks/analytics` | *org*, scoped by role |
| GET/PATCH/DELETE | `/tasks/:id` | *org*: creator / assignee / manager+ |

## Project structure

```
server/
  prisma/            schema, migrations, seed
  src/
    config/          env validation, logger, db, redis
    middleware/      auth + RBAC, validation, rate limiting, errors
    modules/         auth, orgs (members, invitations), projects, tasks, audit
    jobs/            BullMQ queues, worker, mailer
    sockets/         Socket.IO server + Redis adapter
    docs/            OpenAPI spec
  tests/             unit + integration tests
client/src/          React app (pages, components, API client, realtime hook)
infra/nginx/         load balancer + static hosting
```

## Roadmap

- [x] Calendar view and analytics charts
- [x] Multi-tenant organizations, invitations, projects, seats, audit log
- [ ] Stripe billing (per-seat plans, trials, customer portal)
- [ ] SSO (SAML / OIDC) and SCIM provisioning
- [ ] Comments, @mentions, attachments, in-app notifications
- [ ] Deploy (Vercel for client, Render/Railway/Fly for API + worker)
- [ ] Postgres read replicas for list/stats queries
- [ ] Prometheus metrics + Grafana dashboard
