import type { Book, BookCopy, Prisma } from '../generated/prisma/client.js';

type LockedBook = Pick<Book, 'id' | 'archivedAt' | 'dailyPrice' | 'depositAmount'>;

export async function lockBookForCopyWrite(tx: Prisma.TransactionClient, bookId: string) {
  // SHARE blocks changes to tariffs and archival and permits writes on different copies.
  const [book] = await tx.$queryRaw<LockedBook[]>`
    SELECT "id", "archivedAt", "dailyPrice", "depositAmount"
    FROM "Book" WHERE "id" = ${bookId}::uuid FOR SHARE NOWAIT
  `;
  return book ?? null;
}

export async function lockBookCopyForWrite(tx: Prisma.TransactionClient, bookId: string, copyId: string) {
  // UPDATE also blocks the FK key-share lock of a concurrent Rental insertion.
  const [copy] = await tx.$queryRaw<BookCopy[]>`
    SELECT "id", "bookId", "inventoryCode", "status", "condition", "conditionNotes" FROM "BookCopy"
    WHERE "id" = ${copyId}::uuid AND "bookId" = ${bookId}::uuid FOR UPDATE NOWAIT
  `;
  return copy ?? null;
}
