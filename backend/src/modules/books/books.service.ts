import type { Book } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import type { BooksRepository, BookWriteResult } from './books.repository.js';
import type { CreateBookInput, ListBooksQuery, UpdateBookInput } from './books.schemas.js';

function serializeBook<T extends Book>(book: T) {
  return { ...book, dailyPrice: book.dailyPrice.toFixed(2), depositAmount: book.depositAmount.toFixed(2) };
}

export class BooksService {
  constructor(private readonly repository: BooksRepository) {}

  async list(query: ListBooksQuery) {
    const { items, total } = await this.repository.list(query);
    return {
      data: items.map(serializeBook),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    };
  }

  async getById(id: string) {
    const book = await this.repository.findById(id);
    if (!book) throw new ApiError(404, 'BOOK_NOT_FOUND', 'Book not found');
    return serializeBook(book);
  }

  async create(input: CreateBookInput) {
    return serializeBook(await this.repository.create(input));
  }

  async update(id: string, input: UpdateBookInput) {
    this.assertWrite(await this.repository.update(id, input));
    return this.getById(id);
  }

  async archive(id: string) {
    this.assertWrite(await this.repository.archive(id, new Date()));
  }

  private assertWrite(result: BookWriteResult) {
    if (result === 'not_found') throw new ApiError(404, 'BOOK_NOT_FOUND', 'Book not found');
    if (result === 'archived') throw new ApiError(409, 'BOOK_ARCHIVED', 'Book is archived; restore it before editing or archiving again');
  }
}
