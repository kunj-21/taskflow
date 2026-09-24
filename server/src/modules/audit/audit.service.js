import { prisma } from '../../config/db.js';
import { logger } from '../../config/logger.js';

// Append-only audit trail. Failures are logged but never fail the user's request.
export async function audit(req, { action, entityType, entityId = null, metadata = null, orgId = req.org?.id }) {
  if (!orgId) return;
  try {
    await prisma.auditLog.create({
      data: {
        orgId,
        actorId: req.user?.id ?? null,
        action,
        entityType,
        entityId,
        metadata,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    logger.error('Audit write failed', { action, err: err.message });
  }
}

export async function listAudit(orgId, { page, limit, action, actorId }) {
  const where = { orgId, ...(action && { action: { startsWith: action } }), ...(actorId && { actorId }) };
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}
