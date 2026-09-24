import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createRedis } from '../config/redis.js';

let io = null;

export function initSockets(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: env.CLIENT_URL, credentials: true },
  });

  // Redis adapter fans events out across every API instance, so a client connected to
  // instance A still receives events emitted by instance B behind the load balancer.
  io.adapter(createAdapter(createRedis(), createRedis()));

  io.use((socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token, env.JWT_ACCESS_SECRET);
      socket.data.user = { id: payload.sub, role: payload.role };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.data.user;
    socket.join(`user:${id}`);
    if (role === 'ADMIN' || role === 'MANAGER') socket.join('managers');
    logger.debug('Socket connected', { userId: id });
  });

  return io;
}

// Notify everyone who can see this task: creator, assignee (old and new), and managers.
export function emitTaskEvent(event, task, extraUserIds = []) {
  if (!io) return;
  const rooms = new Set(['managers', `user:${task.creatorId}`, ...extraUserIds.filter(Boolean).map((u) => `user:${u}`)]);
  if (task.assigneeId) rooms.add(`user:${task.assigneeId}`);
  io.to([...rooms]).emit(event, task);
}
