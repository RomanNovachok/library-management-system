import { Prisma } from '../../generated/prisma/client.js';
import type { Book, BookCopy } from '../../generated/prisma/client.js';
import type { CreateBookInput, ListBooksQuery, UpdateBookInput } from './books.schemas.js';

export type BookSummary = Book & { copyCount: number; availableCopyCount: number };
export type BookDetails = Book & { copies: (BookCopy & { lastClosedRentalId?: string | null })[] };
export type BookWriteResult = 'updated' | 'not_found' | 'archived';

export interface BooksRepository {
  list(query: ListBooksQuery): Promise<{ items: BookSummary[]; total: number }>;
  findById(id: string): Promise<BookDetails | null>;
  create(input: CreateBookInput): Promise<Book>;
  update(id: string, input: UpdateBookInput): Promise<BookWriteResult>;
  archive(id: string, archivedAt: Date): Promise<BookWriteResult>;
}

type BooksDatabase = Pick<Prisma.TransactionClient, 'book' | 'bookCopy' | '$queryRaw'>;

function moneyData(input: UpdateBookInput) {
  return {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.author !== undefined && { author: input.author }),
    ...(input.genre !== undefined && { genre: input.genre }),
    ...(input.dailyPrice !== undefined && { dailyPrice: new Prisma.Decimal(input.dailyPrice) }),
    ...(input.depositAmount !== undefined && { depositAmount: new Prisma.Decimal(input.depositAmount) }),
  };
}

export class PrismaBooksRepository implements BooksRepository {
  constructor(private readonly database?: BooksDatabase) {}

  private async db(): Promise<BooksDatabase> {
    // Health requests and tests must not initialize a pool or require DATABASE_URL.
    return this.database ?? (await import('../../lib/prisma.js')).prisma;
  }

  async list(query: ListBooksQuery) {
    const db = await this.db();
    const contains = (value: string) => ({
      contains: value.replace(/[\\%_]/g, '\\$&'),
      mode: 'insensitive' as const,
    });
    const where: Prisma.BookWhereInput = {
      ...(!query.includeArchived && { archivedAt: null }),
      ...(query.search && {
        OR: ['title', 'author', 'genre'].map((field) => ({ [field]: contains(query.search!) })),
      }),
      ...(query.title && { title: contains(query.title) }),
      ...(query.author && { author: contains(query.author) }),
      ...(query.genre && { genre: contains(query.genre) }),
    };
    const [books, total] = await Promise.all([
      db.book.findMany({
        where,
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.book.count({ where }),
    ]);
    const counts = books.length ? await db.bookCopy.groupBy({
      by: ['bookId', 'status'],
      where: { bookId: { in: books.map((book) => book.id) } },
      _count: { _all: true },
    }) : [];
    const totals = new Map<string, { copyCount: number; availableCopyCount: number }>();
    for (const count of counts) {
      const current = totals.get(count.bookId) ?? { copyCount: 0, availableCopyCount: 0 };
      current.copyCount += count._count._all;
      if (count.status === 'AVAILABLE') current.availableCopyCount += count._count._all;
      totals.set(count.bookId, current);
    }
    return {
      items: books.map((book) => ({
        ...book,
        ...(totals.get(book.id) ?? { copyCount: 0, availableCopyCount: 0 }),
      })),
      total,
    };
  }

  async findById(id: string) {
    const db = await this.db();
    const book = await db.book.findUnique({
      where: { id },
      include: { copies: { orderBy: [{ inventoryCode: 'asc' }, { id: 'asc' }] } },
    });
    if (!book || book.copies.length === 0) return book;
    const latest = await db.$queryRaw<{ copyId: string; rentalId: string }[]>`
      SELECT DISTINCT ON (r."copyId") r."copyId", r."id" AS "rentalId"
      FROM "Rental" r JOIN "BookCopy" c ON c."id" = r."copyId"
      WHERE c."bookId" = ${id}::uuid AND r."closedAt" IS NOT NULL
      ORDER BY r."copyId", r."closedAt" DESC, r."id" DESC
    `;
    const rentalIds = new Map(latest.map(({ copyId, rentalId }) => [copyId, rentalId]));
    return { ...book, copies: book.copies.map((copy) => ({ ...copy, lastClosedRentalId: rentalIds.get(copy.id) ?? null })) };
  }

  async create(input: CreateBookInput) {
    return (await this.db()).book.create({
      data: {
        title: input.title,
        author: input.author,
        genre: input.genre,
        dailyPrice: new Prisma.Decimal(input.dailyPrice),
        depositAmount: new Prisma.Decimal(input.depositAmount),
      },
    });
  }

  async update(id: string, input: UpdateBookInput): Promise<BookWriteResult> {
    const db = await this.db();
    // The archive predicate belongs in the write to prevent editing after a concurrent archive.
    const result = await db.book.updateMany({ where: { id, archivedAt: null }, data: moneyData(input) });
    return result.count ? 'updated' : this.missingWriteResult(db, id);
  }

  async archive(id: string, archivedAt: Date): Promise<BookWriteResult> {
    const db = await this.db();
    const result = await db.book.updateMany({ where: { id, archivedAt: null }, data: { archivedAt } });
    return result.count ? 'updated' : this.missingWriteResult(db, id);
  }

  private async missingWriteResult(db: BooksDatabase, id: string): Promise<BookWriteResult> {
    return await db.book.findUnique({ where: { id }, select: { id: true } }) ? 'archived' : 'not_found';
  }
}
