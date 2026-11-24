import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';
import type { ReaderCategory } from '../../src/generated/prisma/client.js';
import { ApiError } from '../../src/lib/api-error.js';
import type { ReaderDetails, ReaderRental, ReadersRepository } from '../../src/modules/readers/readers.repository.js';
import type { CreateReaderInput, ListReadersQuery, PaginationQuery, UpdateReaderInput } from '../../src/modules/readers/readers.schemas.js';

export const categoryId = 'f3488667-8cf7-41df-923e-224296c84711';
export const otherCategoryId = 'f3488667-8cf7-41df-923e-224296c84712';
export const missingId = 'f3488667-8cf7-41df-923e-224296c84799';
export const validReaderInput = { fullName: 'Тестовий Читач Альфа', address: 'Умовна адреса, будинок 1', phone: '+380 (00) 000-00-01', categoryId };

export class MemoryReadersRepository implements ReadersRepository {
  readonly readers = new Map<string, ReaderDetails>();
  readonly categoryRows: ReaderCategory[] = [
    { id: categoryId, name: 'Тестова категорія', discountPercent: new Prisma.Decimal('0') },
    { id: otherCategoryId, name: 'Інша тестова категорія', discountPercent: new Prisma.Decimal('12.50') },
  ];
  readonly rentalRows: ReaderRental[] = [];
  async categories() { return this.categoryRows; }
  async findCategory(id: string) { return this.categoryRows.find((row) => row.id === id) ?? null; }
  async findById(id: string) {
    const row = this.readers.get(id);
    return row ? { ...row, category: (await this.findCategory(row.categoryId))! } : null;
  }
  async list(query: ListReadersQuery) {
    const search = query.search?.toLowerCase();
    const rows = await Promise.all([...this.readers.keys()].map((id) => this.findById(id)));
    const items = rows.filter((row): row is ReaderDetails => row !== null)
      .filter((row) => (!query.categoryId || row.categoryId === query.categoryId) && (!search || row.fullName.toLowerCase().includes(search) || row.phone.toLowerCase().includes(search)))
      .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));
    return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: items.length };
  }
  async create(input: CreateReaderInput) {
    const row = { ...input, id: randomUUID(), category: (await this.findCategory(input.categoryId))! };
    this.readers.set(row.id, row);
    return row;
  }
  async update(id: string, input: UpdateReaderInput) {
    const previous = this.readers.get(id);
    if (!previous) throw new ApiError(404, 'READER_NOT_FOUND', 'Читача не знайдено');
    const row = { ...previous, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) };
    row.category = (await this.findCategory(row.categoryId))!;
    this.readers.set(id, row);
    return row;
  }
  async rentals(id: string, query: PaginationQuery) {
    const rows = this.rentalRows.filter((row) => row.readerId === id).sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime() || b.id.localeCompare(a.id));
    return { items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length };
  }
}
