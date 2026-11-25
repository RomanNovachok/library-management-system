export type CopyStatus = 'AVAILABLE' | 'RENTED' | 'MAINTENANCE' | 'LOST';
export const inspectedConditions = ['GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE'] as const;
export type InspectedCondition = typeof inspectedConditions[number];
export type CopyCondition = InspectedCondition | 'UNKNOWN' | 'LOST';
export interface ConditionData { condition: CopyCondition; conditionNotes: string | null }
export interface CopyInspection { condition: InspectedCondition; conditionNotes?: string | null }
export const isCopyCondition = (value: unknown): value is CopyCondition =>
  value === 'LOST' || value === 'UNKNOWN' || inspectedConditions.some((condition) => value === condition);
export const isConditionNotes = (value: unknown) => value === null || typeof value === 'string' && value.trim().length > 0;

export interface Book {
  id: string;
  title: string;
  author: string;
  genre: string;
  dailyPrice: string;
  depositAmount: string;
  archivedAt: string | null;
}

export interface BookCopy extends ConditionData {
  id: string;
  bookId: string;
  inventoryCode: string;
  status: CopyStatus;
  lastClosedRentalId?: string | null;
}

export type BookInput = Pick<Book, 'title' | 'author' | 'genre' | 'dailyPrice' | 'depositAmount'>;
export type EditableCopyStatus = Extract<CopyStatus, 'AVAILABLE' | 'MAINTENANCE'>;
export interface CopyInput extends Partial<CopyInspection> { inventoryCode: string }
export interface CopyUpdateInput extends Partial<CopyInput> { status?: EditableCopyStatus }

export interface BookSummary extends Book {
  copyCount: number;
  availableCopyCount: number;
}

export interface BookDetails extends Book {
  copies: BookCopy[];
}

export interface BooksResponse {
  data: BookSummary[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function money(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value);
}

function book(value: unknown): value is Book {
  return record(value) && uuid(value.id) && text(value.title) && text(value.author) && text(value.genre)
    && money(value.dailyPrice) && money(value.depositAmount)
    && (value.archivedAt === null || (text(value.archivedAt) && Number.isFinite(Date.parse(value.archivedAt))));
}

function copy(value: unknown): value is BookCopy {
  return record(value) && uuid(value.id) && uuid(value.bookId) && text(value.inventoryCode)
    && typeof value.status === 'string' && ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST'].includes(value.status)
    && isCopyCondition(value.condition) && isConditionNotes(value.conditionNotes)
    && (value.lastClosedRentalId === undefined || value.lastClosedRentalId === null || uuid(value.lastClosedRentalId));
}

export function isBooksResponse(value: unknown): value is BooksResponse {
  if (!record(value) || !Array.isArray(value.data) || !record(value.pagination)) return false;
  const { page, pageSize, total, totalPages } = value.pagination;
  return count(page) && page >= 1 && page <= 1_000_000 && count(pageSize) && pageSize >= 1 && pageSize <= 100
    && count(total) && count(totalPages) && totalPages === Math.ceil(total / pageSize)
    && value.data.length <= pageSize && value.data.length <= total
    && value.data.every((item: unknown) => book(item) && record(item)
      && count(item.copyCount) && count(item.availableCopyCount) && item.availableCopyCount <= item.copyCount);
}

export function isBookDetailsResponse(value: unknown): value is { data: BookDetails } {
  if (!record(value) || !book(value.data) || !record(value.data)) return false;
  const data = value.data;
  return Array.isArray(data.copies) && data.copies.every((item: unknown) => copy(item) && item.bookId === data.id);
}

export function isBookCopiesResponse(value: unknown): value is { data: BookCopy[] } {
  return record(value) && Array.isArray(value.data) && value.data.every(copy);
}

export function isBookResponse(value: unknown): value is { data: Book } {
  return record(value) && book(value.data);
}

export function isBookCopyResponse(value: unknown): value is { data: BookCopy } {
  return record(value) && copy(value.data);
}
