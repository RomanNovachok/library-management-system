import type { Prisma } from '../src/generated/prisma/client.js';

export async function databaseSnapshot(db: Prisma.TransactionClient) {
  return JSON.stringify(await Promise.all([
    db.book.findMany({ orderBy: { id: 'asc' } }),
    db.bookCopy.findMany({ orderBy: { id: 'asc' } }),
    db.rental.findMany({ orderBy: { id: 'asc' } }),
    db.reader.findMany({ orderBy: { id: 'asc' } }),
    db.readerCategory.findMany({ orderBy: { id: 'asc' } }),
    db.damageRule.findMany({ orderBy: { id: 'asc' } }),
    db.cashMovement.findMany({ orderBy: { id: 'asc' } }),
    db.staffUser.findMany({ orderBy: { id: 'asc' } }),
    db.staffSession.findMany({ orderBy: { tokenHash: 'asc' } }),
    db.auditLog.findMany({ orderBy: { id: 'asc' } }),
  ]));
}
