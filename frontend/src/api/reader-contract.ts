export interface ReaderCategory { id: string; name: string; discountPercent: string }
export interface ReaderInput { fullName: string; address: string; phone: string; categoryId: string }
export interface Reader extends ReaderInput { id: string; category: ReaderCategory }
export interface ReaderRental {
  id: string; readerId: string; status: 'ACTIVE' | 'RETURNED' | 'LOST';
  issuedAt: string; dueAt: string; closedAt: string | null; bookTitle: string; inventoryCode: string;
}
export interface Pagination { page: number; pageSize: number; total: number; totalPages: number }
export interface Page<T> { data: T[]; pagination: Pagination }
export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
function category(value: unknown): value is ReaderCategory {
  return record(value) && uuid(value.id) && text(value.name) && typeof value.discountPercent === 'string'
    && /^(?:(?:0|[1-9]\d?)\.\d{2}|100\.00)$/.test(value.discountPercent);
}
function reader(value: unknown): value is Reader {
  return record(value) && uuid(value.id) && text(value.fullName) && text(value.address) && text(value.phone)
    && uuid(value.categoryId) && category(value.category) && value.categoryId.toLowerCase() === value.category.id.toLowerCase();
}
function rental(value: unknown): value is ReaderRental {
  return record(value) && uuid(value.id) && uuid(value.readerId) && ['ACTIVE', 'RETURNED', 'LOST'].includes(String(value.status))
    && date(value.issuedAt) && date(value.dueAt) && (value.closedAt === null || date(value.closedAt)) && text(value.bookTitle) && text(value.inventoryCode);
}
export function isPage<T>(value: unknown, item: (value: unknown) => value is T): value is Page<T> {
  if (!record(value) || !Array.isArray(value.data) || !value.data.every(item) || !record(value.pagination)) return false;
  const p = value.pagination;
  return count(p.page) && p.page >= 1 && p.page <= 1_000_000 && count(p.pageSize) && p.pageSize >= 1 && p.pageSize <= 100
    && count(p.total) && count(p.totalPages) && p.totalPages === Math.ceil(p.total / p.pageSize)
    && value.data.length <= p.pageSize && value.data.length <= p.total;
}
export const isReadersResponse = (value: unknown): value is Page<Reader> => isPage(value, reader);
export const isReaderRentalsResponse = (value: unknown): value is Page<ReaderRental> => isPage(value, rental);
export const isReaderResponse = (value: unknown): value is { data: Reader } => record(value) && reader(value.data);
export const isReaderCategoriesResponse = (value: unknown): value is { data: ReaderCategory[] } => record(value) && Array.isArray(value.data) && value.data.every(category);
