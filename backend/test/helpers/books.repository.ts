import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client.js';
import type { Book, BookCopy } from '../../src/generated/prisma/client.js';
import type { BooksRepository, BookWriteResult } from '../../src/modules/books/books.repository.js';
import type { CreateBookInput, ListBooksQuery, UpdateBookInput } from '../../src/modules/books/books.schemas.js';

export const bookId = 'ba339933-8b3b-49ee-92f2-e0c13c0d15ae';
export const archivedBookId = '10673bfd-529a-4c73-a8e5-2c43cf04850c';
export const missingBookId = 'b80ec80c-ed43-40cb-9450-09d9bf83c72c';
export const validBookInput: CreateBookInput = {
  title: 'New Book', author: 'An Author', genre: 'Novel', dailyPrice: '12.50', depositAmount: '300.00',
};

// Test double only: production always uses PrismaBooksRepository.
export class MemoryBooksRepository implements BooksRepository {
  readonly books = new Map<string, Book>([
    [bookId, { id: bookId, ...validBookInput, title: 'Alpha', author: 'Lesia', genre: 'Drama', dailyPrice: new Prisma.Decimal('4.5'), depositAmount: new Prisma.Decimal('250'), archivedAt: null }],
    [archivedBookId, { id: archivedBookId, ...validBookInput, title: 'Archived', dailyPrice: new Prisma.Decimal('6'), depositAmount: new Prisma.Decimal('400'), archivedAt: new Date('2026-01-01T00:00:00Z') }],
  ]);
  readonly copies: BookCopy[] = ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST'].map((status, index) => ({
    id: randomUUID(), bookId, inventoryCode: `TEST-${index}`, status: status as BookCopy['status'],
  }));
  readonly rentalHistory = [{ id: randomUUID(), copyId: this.copies[1]!.id, depositSnapshot: '250.00' }];

  async list(query: ListBooksQuery) {
    const contains = (text: string, term: string) => text.toLowerCase().includes(term.toLowerCase());
    const all = [...this.books.values()].filter((book) =>
      (query.includeArchived || book.archivedAt === null)
      && (!query.search || [book.title, book.author, book.genre].some((text) => contains(text, query.search!)))
      && (!query.title || contains(book.title, query.title))
      && (!query.author || contains(book.author, query.author))
      && (!query.genre || contains(book.genre, query.genre)),
    ).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return {
      total: all.length,
      items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((book) => ({
        ...book,
        copyCount: this.copies.filter((copy) => copy.bookId === book.id).length,
        availableCopyCount: this.copies.filter((copy) => copy.bookId === book.id && copy.status === 'AVAILABLE').length,
      })),
    };
  }

  async findById(id: string) {
    const book = this.books.get(id);
    return book ? { ...book, copies: this.copies.filter((copy) => copy.bookId === id) } : null;
  }

  async create(input: CreateBookInput) {
    const book: Book = {
      ...input, id: randomUUID(), dailyPrice: new Prisma.Decimal(input.dailyPrice), depositAmount: new Prisma.Decimal(input.depositAmount), archivedAt: null,
    };
    this.books.set(book.id, book);
    return book;
  }

  async update(id: string, input: UpdateBookInput): Promise<BookWriteResult> {
    const book = this.books.get(id);
    if (!book) return 'not_found';
    if (book.archivedAt) return 'archived';
    this.books.set(id, {
      ...book, ...input,
      title: input.title ?? book.title,
      author: input.author ?? book.author,
      genre: input.genre ?? book.genre,
      dailyPrice: input.dailyPrice === undefined ? book.dailyPrice : new Prisma.Decimal(input.dailyPrice),
      depositAmount: input.depositAmount === undefined ? book.depositAmount : new Prisma.Decimal(input.depositAmount),
    });
    return 'updated';
  }

  async archive(id: string, archivedAt: Date): Promise<BookWriteResult> {
    const book = this.books.get(id);
    if (!book) return 'not_found';
    if (book.archivedAt) return 'archived';
    this.books.set(id, { ...book, archivedAt });
    return 'updated';
  }
}
