import { Prisma } from '@prisma/client';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export function notFound(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') { status = 409; message = 'Resource already exists'; }
    if (err.code === 'P2025') { status = 404; message = 'Resource not found'; }
  }

  if (status >= 500) {
    logger.error(message, { stack: err.stack, requestId: req.id, path: req.originalUrl });
    if (env.isProd) message = 'Internal server error';
  }

  res.status(status).json({ error: message, ...(err.details && { details: err.details }), requestId: req.id });
}
