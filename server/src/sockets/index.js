import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/db.js';
import { createRedis } from '../config/redis.js';
import { isManager } from '../middleware/auth.js';

let io = null;

// Rooms are always org-qualified so events never cross tenants:
//   org:<orgId>:managers        managers and above in that org
//   org:<orgId>:user:<userId>   one person, in that org only
const managersRoom = (orgId) => `org:${orgId}:managers`;
const userRoom = (orgId, userId) => `org:${orgId}:user:${userId}`;

export function initSockets(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: env.CLIENT_URL, credentials: true },
  });

  // Redis adapter fans events out across every API instance, so a client connected to
  // instance A still receives events emitted by instance B behind the load balancer.
  io.adapter(createAdapter(createRedis(), createRedis()));

  // The handshake names the org; membership is checked before joining any room.
  io.use(async (socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token, env.JWT_ACCESS_SECRET);
      const orgId = socket.handshake.auth?.orgId;
      const membership = orgId && await prisma.membership.findUnique({
        where: { userId_orgId: { userId: payload.sub, orgId } }, select: { role: true },
      });
      if (!membership) return next(new Error('forbidden'));
      socket.data = { userId: payload.sub, orgId, role: membership.role };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, orgId, role } = socket.data;
    socket.join(userRoom(orgId, userId));
    if (isManager({ role })) socket.join(managersRoom(orgId));
    logger.debug('Socket connected', { userId, orgId });
  });

  return io;
}

// Notify everyone in the org who can see this task: creator, assignee (old and new), and managers.
export function emitTaskEvent(orgId, event, task, extraUserIds = []) {
  if (!io) return;
  const rooms = new Set([managersRoom(orgId), userRoom(orgId, task.creatorId)]);
  if (task.assigneeId) rooms.add(userRoom(orgId, task.assigneeId));
  extraUserIds.filter(Boolean).forEach((u) => rooms.add(userRoom(orgId, u)));
  io.to([...rooms]).emit(event, { ...task, orgId });
}
