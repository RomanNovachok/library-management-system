import { Prisma } from '../../generated/prisma/client.js';
import type { Reader, ReaderCategory } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import type { CreateReaderInput, ListReadersQuery, PaginationQuery, UpdateReaderInput } from './readers.schemas.js';

export type ReaderDetails = Reader & { category: ReaderCategory };
const rentalSelect = {
  id: true, readerId: true, status: true, issuedAt: true, dueAt: true, closedAt: true,
  copy: { select: { inventoryCode: true, book: { select: { title: true } } } },
} satisfies Prisma.RentalSelect;
export type ReaderRental = Prisma.RentalGetPayload<{ select: typeof rentalSelect }>;
export interface ReadersRepository {
  list(query: ListReadersQuery): Promise<{ items: ReaderDetails[]; total: number }>;
  findById(id: string): Promise<ReaderDetails | null>;
  categories(): Promise<ReaderCategory[]>;
  findCategory(id: string): Promise<ReaderCategory | null>;
  create(input: CreateReaderInput): Promise<ReaderDetails>;
  update(id: string, input: UpdateReaderInput): Promise<ReaderDetails>;
  rentals(id: string, query: PaginationQuery): Promise<{ items: ReaderRental[]; total: number }>;
}
type Database = Pick<Prisma.TransactionClient, 'reader' | 'readerCategory' | 'rental'>;

export class PrismaReadersRepository implements ReadersRepository {
  constructor(private readonly database?: Database) {}

  private async execute<T>(operation: (db: Database) => Promise<T>): Promise<T> {
    try {
      return await operation(this.database ?? (await import('../../lib/prisma.js')).prisma);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw new ApiError(404, 'READER_NOT_FOUND', 'Читача не знайдено');
        if (error.code === 'P2003') throw new ApiError(409, 'READER_CATEGORY_CONFLICT', 'Категорія більше недоступна. Оновіть дані');
        if (error.code === 'P2034') throw new ApiError(409, 'READER_WRITE_CONFLICT', 'Конкурентна зміна. Оновіть дані');
      }
      // Prisma errors may embed query arguments containing personal data. Do not log them.
      throw new Error('Readers database operation failed');
    }
  }

  list(query: ListReadersQuery) {
    return this.execute(async (db) => {
      const contains = query.search && { contains: query.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' as const };
      const where: Prisma.ReaderWhereInput = {
        ...(contains && { OR: [{ fullName: contains }, { phone: contains }] }),
        ...(query.categoryId && { categoryId: query.categoryId }),
      };
      const [items, total] = await Promise.all([
        db.reader.findMany({ where, include: { category: true }, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        db.reader.count({ where }),
      ]);
      return { items, total };
    });
  }

  findById(id: string) {
    return this.execute((db) => db.reader.findUnique({ where: { id }, include: { category: true } }));
  }
  categories() {
    return this.execute((db) => db.readerCategory.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }));
  }
  findCategory(id: string) {
    return this.execute((db) => db.readerCategory.findUnique({ where: { id } }));
  }
  create(input: CreateReaderInput) {
    return this.execute((db) => db.reader.create({ data: input, include: { category: true } }));
  }
  update(id: string, input: UpdateReaderInput) {
    // One atomic UPDATE of supplied scalar fields; no stale read/merge/write and no nested Rental writes.
    const data = {
      ...(input.fullName !== undefined && { fullName: input.fullName }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
    };
    return this.execute((db) => db.reader.update({ where: { id }, data, include: { category: true } }));
  }
  rentals(id: string, query: PaginationQuery) {
    return this.execute(async (db) => {
      const where = { readerId: id };
      const [items, total] = await Promise.all([
        db.rental.findMany({ where, select: rentalSelect, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        db.rental.count({ where }),
      ]);
      return { items, total };
    });
  }
}
