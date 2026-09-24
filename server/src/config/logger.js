import winston from 'winston';
import { env } from './env.js';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}: ${stack || message}${extra}`;
});

// JSON logs in production so they can be shipped to Loki/ELK/Datadog as-is.
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  silent: env.isTest,
  format: combine(timestamp(), errors({ stack: true }), env.isProd ? json() : combine(colorize(), devFormat)),
  defaultMeta: { service: 'taskflow-api', pid: process.pid },
  transports: [new winston.transports.Console()],
});

export const httpLogStream = { write: (msg) => logger.http(msg.trim()) };
