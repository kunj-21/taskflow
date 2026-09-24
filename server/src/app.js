import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import passport from 'passport';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { httpLogStream } from './config/logger.js';
import { prisma } from './config/db.js';
import { redis } from './config/redis.js';
import { requestId } from './middleware/requestId.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { swaggerSpec } from './docs/swagger.js';
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/users.routes.js';
import taskRoutes from './modules/tasks/tasks.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind NGINX: real client IP for rate limiting
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(passport.initialize());
  if (!env.isTest) {
    morgan.token('id', (req) => req.id);
    app.use(morgan(':id :method :url :status :res[content-length] - :response-time ms', { stream: httpLogStream }));
  }

  // Liveness: process is up. Readiness: dependencies reachable (used by load balancer / orchestrator).
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    const checks = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    const [db, cache] = checks.map((c) => c.status === 'fulfilled');
    res.status(db && cache ? 200 : 503).json({ db, redis: cache });
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

  const v1 = express.Router();
  v1.use(apiLimiter);
  v1.use('/auth', authRoutes);
  v1.use('/users', userRoutes);
  v1.use('/tasks', taskRoutes);
  app.use('/api/v1', v1);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
