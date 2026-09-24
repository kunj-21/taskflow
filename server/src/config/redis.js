import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

// BullMQ requires maxRetriesPerRequest: null on its connections.
export function createRedis(opts = {}) {
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: env.isTest, ...opts });
  client.on('error', (err) => logger.error('Redis error', { err: err.message }));
  return client;
}

export const redis = createRedis();
