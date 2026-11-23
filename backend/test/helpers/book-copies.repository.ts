import { randomUUID } from 'node:crypto';
import type { BookCopy, CopyStatus } from '../../src/generated/prisma/client.js';
import { ApiError } from '../../src/lib/api-error.js';
import { copyWriteConflict } from '../../src/modules/book-copies/book-copies.repository.js';
import type { BookCopiesRepository, BookCopiesWriteRepository, CopyBook } from '../../src/modules/book-copies/book-copies.repository.js';
import type { UpdateBookCopyInput } from '../../src/modules/book-copies/book-copies.schemas.js';

export const copiesBookId = '1ffb34cd-3170-4732-a79a-c5d8428ea1d1';
export const copiesArchivedBookId = '443014fb-27fc-4eee-97ca-657113622916';
export const otherBookId = 'e72e2e15-cdef-4eb2-a91e-6d20c959cfba';
export const absentId = '04809a2c-b734-42fd-a126-ac751a0cc4c0';

// Test-only transaction double; PostgreSQL locking is verified separately by db:check-book-copies.
export class MemoryBookCopiesRepository implements BookCopiesRepository, BookCopiesWriteRepository {
  readonly books = new Map<string, CopyBook>([
    [copiesBookId, { id: copiesBookId, archivedAt: null }],
    [otherBookId, { id: otherBookId, archivedAt: null }],
    [copiesArchivedBookId, { id: copiesArchivedBookId, archivedAt: new Date('2026-01-01T00:00:00Z') }],
  ]);
  readonly copies = new Map<string, BookCopy>();
  readonly activeRentals = new Set<string>();
  readonly rentalHistory = new Set<string>();
  private writing = false;

  constructor() {
    for (const status of ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST'] as const) {
      const id = randomUUID();
      this.copies.set(id, { id, bookId: copiesBookId, inventoryCode: `TEST-${status}`, status });
      if (status === 'RENTED') { this.activeRentals.add(id); this.rentalHistory.add(id); }
      if (status === 'LOST') this.rentalHistory.add(id);
    }
  }

  copyWithStatus(status: CopyStatus) {
    return [...this.copies.values()].find((copy) => copy.bookId === copiesBookId && copy.status === status)!;
  }

  async findBook(id: string) { return this.books.get(id) ?? null; }
  async lockBook(id: string) { return this.findBook(id); }
  async list(bookId: string, status?: CopyStatus) {
    return [...this.copies.values()].filter((copy) => copy.bookId === bookId && (!status || copy.status === status))
      .sort((a, b) => a.inventoryCode.localeCompare(b.inventoryCode) || a.id.localeCompare(b.id));
  }
  async findById(bookId: string, copyId: string) {
    const copy = this.copies.get(copyId);
    return copy?.bookId === bookId ? { ...copy } : null;
  }
  async lockCopy(bookId: string, copyId: string) { return this.findById(bookId, copyId); }
  async hasRentals(copyId: string, activeOnly: boolean) {
    return this.activeRentals.has(copyId) || (!activeOnly && this.rentalHistory.has(copyId));
  }
  async create(bookId: string, inventoryCode: string) {
    this.assertUnique(inventoryCode);
    const copy: BookCopy = { id: randomUUID(), bookId, inventoryCode, status: 'AVAILABLE' };
    this.copies.set(copy.id, copy);
    return copy;
  }
  async update(copy: BookCopy, input: UpdateBookCopyInput) {
    if (input.inventoryCode !== undefined) this.assertUnique(input.inventoryCode, copy.id);
    const updated = { ...copy, inventoryCode: input.inventoryCode ?? copy.inventoryCode, status: input.status ?? copy.status };
    this.copies.set(copy.id, updated);
    return updated;
  }
  async delete(copy: BookCopy) { this.copies.delete(copy.id); }

  async transaction<T>(operation: (tx: BookCopiesWriteRepository) => Promise<T>): Promise<T> {
    if (this.writing) throw copyWriteConflict();
    this.writing = true;
    const before = new Map([...this.copies].map(([id, copy]) => [id, { ...copy }]));
    try { return await operation(this); }
    catch (error) {
      this.copies.clear();
      for (const [id, copy] of before) this.copies.set(id, copy);
      throw error;
    } finally { this.writing = false; }
  }

  private assertUnique(inventoryCode: string, exceptId?: string) {
    if ([...this.copies.values()].some((copy) => copy.id !== exceptId && copy.inventoryCode === inventoryCode)) {
      throw new ApiError(409, 'INVENTORY_CODE_EXISTS', 'Inventory code is already in use');
    }
  }
}
