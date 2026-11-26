import type { Prisma } from '../generated/prisma/client.js';

export async function writeAuditLog(
  data: Prisma.AuditLogUncheckedCreateInput,
  database?: Pick<Prisma.TransactionClient, 'auditLog'>,
) {
  const db = database ?? (await import('./prisma.js')).prisma;
  await db.auditLog.create({ data });
}
