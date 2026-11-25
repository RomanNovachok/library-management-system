import type { BookCopy } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import type { BookCopiesRepository, BookCopiesWriteRepository, CopyBook } from './book-copies.repository.js';
import type { CreateBookCopyInput, ListBookCopiesQuery, UpdateBookCopyInput } from './book-copies.schemas.js';
import { assertCopyCondition } from './copy-condition.js';

export class BookCopiesService {
  constructor(private readonly repository: BookCopiesRepository) {}

  async list(bookId: string, query: ListBookCopiesQuery) {
    this.requireBook(await this.repository.findBook(bookId));
    return this.repository.list(bookId, query.status);
  }

  async getById(bookId: string, copyId: string) {
    this.requireBook(await this.repository.findBook(bookId));
    return this.requireCopy(await this.repository.findById(bookId, copyId));
  }

  async create(bookId: string, input: CreateBookCopyInput) {
    return this.repository.transaction(async (tx) => {
      this.requireWritableBook(this.requireBook(await tx.lockBook(bookId)));
      const condition = input.condition ?? 'GOOD';
      const conditionNotes = input.conditionNotes ?? null;
      const status = condition === 'MAJOR_DAMAGE' ? 'MAINTENANCE' : 'AVAILABLE';
      assertCopyCondition({ condition, conditionNotes }, status);
      return tx.create({ bookId, inventoryCode: input.inventoryCode, condition, conditionNotes, status });
    });
  }

  async update(bookId: string, copyId: string, input: UpdateBookCopyInput) {
    return this.writeCopy(bookId, copyId, async (tx, copy) => {
      const changesCondition = input.condition !== undefined || input.conditionNotes !== undefined;
      if (input.status !== undefined || changesCondition) {
        const status = input.status ?? copy.status;
        if (!['AVAILABLE', 'MAINTENANCE'].includes(status) || !['AVAILABLE', 'MAINTENANCE'].includes(copy.status)) {
          throw new ApiError(409, 'COPY_STATUS_CONFLICT', 'Only AVAILABLE and MAINTENANCE statuses can be managed here');
        }
        if (await tx.hasRentals(copy.id, true)) {
          throw new ApiError(409, 'COPY_ACTIVE_RENTAL', 'A copy with an active rental cannot change status or condition');
        }
        assertCopyCondition({
          condition: input.condition ?? copy.condition,
          conditionNotes: input.conditionNotes === undefined ? copy.conditionNotes : input.conditionNotes,
        }, status);
      }
      return tx.update(copy, input);
    });
  }

  async delete(bookId: string, copyId: string) {
    return this.writeCopy(bookId, copyId, async (tx, copy) => {
      if (copy.status !== 'AVAILABLE') {
        throw new ApiError(409, 'COPY_STATUS_CONFLICT', 'Only an AVAILABLE copy can be deleted');
      }
      if (await tx.hasRentals(copy.id, false)) {
        throw new ApiError(409, 'COPY_HAS_RENTALS', 'A copy with rental history cannot be deleted');
      }
      await tx.delete(copy);
    });
  }

  private writeCopy<T>(bookId: string, copyId: string, operation: (tx: BookCopiesWriteRepository, copy: BookCopy) => Promise<T>) {
    return this.repository.transaction(async (tx) => {
      const book = this.requireBook(await tx.lockBook(bookId));
      const copy = this.requireCopy(await tx.lockCopy(bookId, copyId));
      this.requireWritableBook(book);
      return operation(tx, copy);
    });
  }

  private requireBook(book: CopyBook | null) {
    if (!book) throw new ApiError(404, 'BOOK_NOT_FOUND', 'Book not found');
    return book;
  }

  private requireCopy(copy: BookCopy | null) {
    if (!copy) throw new ApiError(404, 'COPY_NOT_FOUND', 'Book copy not found');
    return copy;
  }

  private requireWritableBook(book: CopyBook) {
    if (book.archivedAt !== null) throw new ApiError(409, 'BOOK_ARCHIVED', 'Book is archived; restore it before changing copies');
  }
}
