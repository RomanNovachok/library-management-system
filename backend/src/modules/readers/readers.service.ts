import { ApiError } from '../../lib/api-error.js';
import type { ReaderCategory } from '../../generated/prisma/client.js';
import type { ReaderDetails, ReadersRepository } from './readers.repository.js';
import type { CreateReaderInput, ListReadersQuery, PaginationQuery, UpdateReaderInput } from './readers.schemas.js';

const categoryJson = (category: ReaderCategory) => ({ ...category, discountPercent: category.discountPercent.toFixed(2) });
const readerJson = (reader: ReaderDetails) => ({ ...reader, category: categoryJson(reader.category) });
const pagination = (query: PaginationQuery, total: number) => ({ ...query, total, totalPages: Math.ceil(total / query.pageSize) });

export class ReadersService {
  constructor(private readonly repository: ReadersRepository) {}

  async list(query: ListReadersQuery) {
    const { items, total } = await this.repository.list(query);
    return { data: items.map(readerJson), pagination: pagination({ page: query.page, pageSize: query.pageSize }, total) };
  }
  async getById(id: string) {
    const reader = await this.repository.findById(id);
    if (!reader) throw new ApiError(404, 'READER_NOT_FOUND', 'Читача не знайдено');
    return readerJson(reader);
  }
  async categories() {
    return { data: (await this.repository.categories()).map(categoryJson) };
  }
  private async assertCategory(id: string) {
    if (!await this.repository.findCategory(id)) throw new ApiError(400, 'READER_CATEGORY_NOT_FOUND', 'Категорію не знайдено. Виберіть категорію зі списку');
  }
  async create(input: CreateReaderInput) {
    await this.assertCategory(input.categoryId);
    return readerJson(await this.repository.create(input));
  }
  async update(id: string, input: UpdateReaderInput) {
    await this.getById(id);
    if (input.categoryId !== undefined) await this.assertCategory(input.categoryId);
    return readerJson(await this.repository.update(id, input));
  }
  async rentals(id: string, query: PaginationQuery) {
    await this.getById(id);
    const { items, total } = await this.repository.rentals(id, query);
    return {
      data: items.map(({ copy, ...rental }) => ({ ...rental, bookTitle: copy.book.title, inventoryCode: copy.inventoryCode })),
      pagination: pagination(query, total),
    };
  }
}
