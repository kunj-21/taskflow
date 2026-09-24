# TaskFlow

A full-stack task management platform built to production standards: role-based access, OAuth, caching, background jobs, real-time updates, and a horizontally scalable deployment.

**Stack:** React · Node.js/Express · PostgreSQL (Prisma) · Redis · BullMQ · Socket.IO · NGINX · Docker

## Features

| Area | What's implemented |
| --- | --- |
| **Auth** | Email/password + Google OAuth 2.0. Short-lived JWT access tokens, rotating refresh tokens in httpOnly cookies, reuse detection that revokes the whole token family. |
| **RBAC** | `ADMIN` / `MANAGER` / `MEMBER`. Only managers and admins can assign work to others; members see only their own tasks and can only move the status of tasks assigned to them. Admins manage roles. |
| **Tasks API** | CRUD, pagination, filtering (status, priority, assignee, due range, full-text search), sorting, dashboard stats. |
| **Caching** | Redis cache-aside on task lists, stats and users, with O(1) namespace-version invalidation on writes. |
| **Background jobs** | BullMQ worker (separate process): due-date email reminders scheduled 24h ahead, weekly report emails via a cron scheduler, retries with exponential backoff. |
| **Real-time** | Socket.IO with JWT handshake and per-user / per-role rooms. Redis adapter so events reach clients on any API instance. |
| **Hardening** | Helmet, CORS, Redis-backed rate limiting (shared across instances), zod validation on every input, centralized error handling, request IDs. |
| **Observability** | Winston structured logs (JSON in prod), Morgan HTTP logs with request IDs, `/health` and `/ready` probes. |
| **Docs & tests** | OpenAPI 3 / Swagger UI at `/api/docs`. Vitest unit tests + Supertest integration tests against real Postgres & Redis. GitHub Actions CI. |
| **Frontend** | Kanban board with drag-and-drop, stats cards, filters, task editor, admin user management, dark mode. |
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

Demo accounts: `admin@taskflow.dev`, `manager@taskflow.dev`, `member@taskflow.dev` (password `password123`).

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

Interactive docs at **http://localhost:4000/api/docs**. Main endpoints (all under `/api/v1`):

| Method | Path | Access |
| --- | --- | --- |
| POST | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | public |
| GET | `/auth/google` | public (OAuth redirect) |
| GET | `/auth/me` | authenticated |
| GET/POST | `/tasks` | authenticated (scoped by role) |
| GET | `/tasks/stats` | authenticated |
| GET | `/tasks/calendar?from&to` | authenticated (scoped by role, max 62 days) |
| GET | `/tasks/analytics?days=7\|30\|90` | authenticated (scoped by role) |
| GET/PATCH/DELETE | `/tasks/:id` | creator / assignee / manager |
| GET | `/users` | authenticated |
| PATCH | `/users/:id/role`, DELETE `/users/:id` | admin |

## Project structure

```
server/
  prisma/            schema, migrations, seed
  src/
    config/          env validation, logger, db, redis
    middleware/      auth + RBAC, validation, rate limiting, errors
    modules/         auth, users, tasks (routes + services + schemas)
    jobs/            BullMQ queues, worker, mailer
    sockets/         Socket.IO server + Redis adapter
    docs/            OpenAPI spec
  tests/             unit + integration tests
client/src/          React app (pages, components, API client, realtime hook)
infra/nginx/         load balancer + static hosting
```

## Roadmap

- [x] Calendar view and analytics charts
- [ ] Deploy (Vercel for client, Render/Railway/Fly for API + worker)
- [ ] Postgres read replicas for list/stats queries
- [ ] Prometheus metrics + Grafana dashboard
- [ ] Comments and activity log on tasks
