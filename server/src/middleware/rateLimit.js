import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';

// Redis-backed store so limits are shared across horizontally scaled API instances.
const store = (prefix) =>
  env.isTest ? undefined : new RedisStore({ prefix, sendCommand: (...args) => redis.call(...args) });

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: store('rl:api:'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, try again later' },
  store: store('rl:auth:'),
});
