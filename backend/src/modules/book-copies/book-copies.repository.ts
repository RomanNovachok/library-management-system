import { Prisma } from '../../generated/prisma/client.js';
import type { BookCopy, CopyStatus } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import type { UpdateBookCopyInput } from './book-copies.schemas.js';

export type CopyBook = { id: string; archivedAt: Date | null };

export interface BookCopiesWriteRepository {
  lockBook(bookId: string): Promise<CopyBook | null>;
  lockCopy(bookId: string, copyId: string): Promise<BookCopy | null>;
  hasRentals(copyId: string, activeOnly: boolean): Promise<boolean>;
  create(bookId: string, inventoryCode: string): Promise<BookCopy>;
  update(copy: BookCopy, input: UpdateBookCopyInput): Promise<BookCopy>;
  delete(copy: BookCopy): Promise<void>;
}

export interface BookCopiesRepository {
  findBook(bookId: string): Promise<CopyBook | null>;
  list(bookId: string, status?: CopyStatus): Promise<BookCopy[]>;
  findById(bookId: string, copyId: string): Promise<BookCopy | null>;
  transaction<T>(operation: (tx: BookCopiesWriteRepository) => Promise<T>): Promise<T>;
}

type TransactionRunner = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
type Connection = {
  db: Pick<Prisma.TransactionClient, 'book' | 'bookCopy'>;
  transaction: TransactionRunner;
};

export function copyWriteConflict() {
  return new ApiError(409, 'COPY_WRITE_CONFLICT', 'Book or copy changed concurrently; reload and retry');
}

function mapWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const adapterError = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
    const sqlState = String(error.meta?.code ?? adapterError?.cause?.originalCode);
    if (error.code === 'P2002') {
      throw new ApiError(409, 'INVENTORY_CODE_EXISTS', 'Inventory code is already in use');
    }
    if (error.code === 'P2003') {
      throw new ApiError(409, 'COPY_RELATION_CONFLICT', 'Related records prevent this copy operation');
    }
    if (error.code === 'P2034' || error.code === 'P2025'
      || (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(sqlState))) {
      throw copyWriteConflict();
    }
  }
  throw error;
}

class PrismaBookCopiesWriteRepository implements BookCopiesWriteRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async lockBook(bookId: string) {
    // SHARE blocks Book archival, but allows concurrent operations on different copies.
    const [book] = await this.tx.$queryRaw<CopyBook[]>`
      SELECT "id", "archivedAt" FROM "Book" WHERE "id" = ${bookId}::uuid FOR SHARE NOWAIT
    `;
    return book ?? null;
  }

  async lockCopy(bookId: string, copyId: string) {
    // UPDATE also blocks the FK key-share lock of a concurrent Rental insertion.
    const [copy] = await this.tx.$queryRaw<BookCopy[]>`
      SELECT "id", "bookId", "inventoryCode", "status" FROM "BookCopy"
      WHERE "id" = ${copyId}::uuid AND "bookId" = ${bookId}::uuid FOR UPDATE NOWAIT
    `;
    return copy ?? null;
  }

  async hasRentals(copyId: string, activeOnly: boolean) {
    return await this.tx.rental.findFirst({
      where: { copyId, ...(activeOnly && { status: 'ACTIVE' }) }, select: { id: true },
    }) !== null;
  }

  async create(bookId: string, inventoryCode: string) {
    return this.tx.bookCopy.create({ data: { bookId, inventoryCode, status: 'AVAILABLE' } });
  }

  async update(copy: BookCopy, input: UpdateBookCopyInput) {
    const result = await this.tx.bookCopy.updateMany({
      where: {
        id: copy.id, bookId: copy.bookId, status: copy.status,
        ...(input.status !== undefined && { rentals: { none: { status: 'ACTIVE' } } }),
      },
      data: {
        ...(input.inventoryCode !== undefined && { inventoryCode: input.inventoryCode }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
    if (result.count !== 1) throw copyWriteConflict();
    return this.tx.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
  }

  async delete(copy: BookCopy) {
    const result = await this.tx.bookCopy.deleteMany({
      where: { id: copy.id, bookId: copy.bookId, status: 'AVAILABLE', rentals: { none: {} } },
    });
    if (result.count !== 1) throw copyWriteConflict();
  }
}

export class PrismaBookCopiesRepository implements BookCopiesRepository {
  constructor(private readonly injectedConnection?: Connection) {}

  private async connection(): Promise<Connection> {
    if (this.injectedConnection) return this.injectedConnection;
    const { prisma } = await import('../../lib/prisma.js');
    return { db: prisma, transaction: (operation) => prisma.$transaction(operation, { isolationLevel: 'ReadCommitted' }) };
  }

  async findBook(bookId: string) {
    return (await this.connection()).db.book.findUnique({ where: { id: bookId }, select: { id: true, archivedAt: true } });
  }

  async list(bookId: string, status?: CopyStatus) {
    return (await this.connection()).db.bookCopy.findMany({
      where: { bookId, ...(status !== undefined && { status }) }, orderBy: [{ inventoryCode: 'asc' }, { id: 'asc' }],
    });
  }

  async findById(bookId: string, copyId: string) {
    return (await this.connection()).db.bookCopy.findFirst({ where: { id: copyId, bookId } });
  }

  async transaction<T>(operation: (tx: BookCopiesWriteRepository) => Promise<T>): Promise<T> {
    try {
      return await (await this.connection()).transaction((tx) => operation(new PrismaBookCopiesWriteRepository(tx)));
    } catch (error) {
      return mapWriteError(error);
    }
  }
}
