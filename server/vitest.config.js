import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://taskflow:taskflow@localhost:5432/taskflow_test?schema=public',
      REDIS_URL: process.env.REDIS_URL_TEST || 'redis://localhost:6379/1',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-123',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-456',
    },
  },
});
