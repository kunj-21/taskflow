import { randomUUID } from 'node:crypto';

// Propagates an X-Request-Id (from NGINX if present) for tracing a request across logs.
export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
