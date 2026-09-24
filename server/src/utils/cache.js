import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// Cache-aside helper. Cache failures never break a request — we fall through to the loader.
export async function cached(key, loader, ttl = env.CACHE_TTL_SECONDS) {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit);
  } catch (err) {
    logger.warn('Cache read failed', { key, err: err.message });
  }

  const value = await loader();
  redis.set(key, JSON.stringify(value), 'EX', ttl).catch((err) =>
    logger.warn('Cache write failed', { key, err: err.message }),
  );
  return value;
}

// Versioned namespaces: bumping the version invalidates every key under it in O(1)
// instead of SCANning and deleting keys (which doesn't scale).
export async function namespaceVersion(ns) {
  try {
    return (await redis.get(`cache:v:${ns}`)) || '0';
  } catch {
    return 'nocache';
  }
}

export async function invalidateNamespace(ns) {
  try {
    await redis.incr(`cache:v:${ns}`);
  } catch (err) {
    logger.warn('Cache invalidation failed', { ns, err: err.message });
  }
}
