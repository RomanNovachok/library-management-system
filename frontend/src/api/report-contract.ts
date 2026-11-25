import type { CopyCondition, CopyStatus } from './book-contract';
import { isRentalStatus, type RentalStatus } from './rental-contract';
import { isPage, record, uuid, type Page } from './reader-contract';
import { isReportMoney } from '../utils/money';

export const availability = ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST'] as const;
export const conditions = ['GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE', 'LOST', 'UNKNOWN'] as const;
export const cashTypes = ['DEPOSIT_IN', 'REFUND_OUT', 'TOPUP_IN'] as const;
export type CashType = typeof cashTypes[number];
export type ArchiveFilter = 'all' | 'active' | 'archived';
export type DateBy = 'issuedAt' | 'closedAt';
export interface Period { from: string; to: string; timeZone: string }
interface Generated { generatedAt: string }
interface ReportBook { id: string; title: string }
interface CopyInfo { book: ReportBook; inventoryCode: string }
interface ReaderInfo { reader: { id: string; fullName: string } }
interface InventoryRow extends ReportBook {
  author: string; genre: string; copies: number; archived: boolean; availableForIssue: number; availability: Record<CopyStatus, number>;
}
export interface InventoryReport extends Page<InventoryRow>, Generated {
  type: 'inventory'; period: null;
  filters: { archived: ArchiveFilter; genre: string | null; search: string | null };
  genres: string[];
  summary: { editions: number; archivedEditions: number; copies: number; availableForIssue: number; availability: Record<CopyStatus, number>; conditions: Record<CopyCondition, number> };
}
export interface ReportRental extends CopyInfo, ReaderInfo {
  id: string; status: RentalStatus; issuedAt: string; dueAt: string; closedAt: string | null; overdueMs: number | null;
}
export interface RentalsReport extends Page<ReportRental>, Generated {
  type: 'rentals'; period: Period;
  filters: { dateBy: DateBy; search: string | null; status: RentalStatus | null; overdue: boolean };
  summary: { current: { total: number; byStatus: Record<RentalStatus, number>; overdue: number }; events: { issued: number; closed: number } };
}
interface Charges { rentalFee: string; damageFine: string; totalCharges: string }
interface Cash { depositIn: string; refundOut: string; topupIn: string; inflow: string; outflow: string; netCash: string }
interface ChargeRow extends Charges, CopyInfo, ReaderInfo { id: string; deposit: string; refund: string; topup: string; closedAt: string }
interface CashRow extends CopyInfo { id: string; type: CashType; amount: string; staffEmail: string; createdAt: string; rentalId: string }
export interface FinancialReport extends Generated {
  type: 'financial'; period: Period;
  summary: { charges: Charges; cash: Cash; outstanding: { activeRentals: number; deposits: string } };
  charges: Page<ChargeRow>; cash: Page<CashRow>;
  trend: { interval: 'day' | 'month' | null; data: ({ bucket: string } & Charges & Cash)[] };
}
export interface Dashboard extends Generated {
  period: Period;
  summary: { editions: number; availableCopies: number; readers: number; maintenanceCopies: number; overdueRentals: number; activeRentals: number };
  financial: Charges & { outstandingDeposits: string };
  latestIssues: ReportRental[]; latestClosures: ReportRental[]; overdue: ReportRental[];
}

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value: unknown): value is string => typeof value === 'string';
const optionalText = (value: unknown) => value === null || text(value);
const counts = (value: unknown, keys: readonly string[]) => record(value) && keys.every((key) => count(value[key]));
const amounts = (value: unknown, keys: readonly string[]) => record(value) && keys.every((key) => isReportMoney(value[key]));
const hasCharges = (value: unknown) => amounts(value, ['rentalFee', 'damageFine', 'totalCharges']);
const hasCash = (value: unknown) => amounts(value, ['depositIn', 'refundOut', 'topupIn', 'inflow', 'outflow', 'netCash']);
const arrayOf = (value: unknown, check: (row: unknown) => boolean) => Array.isArray(value) && value.every(check);
const period = (value: unknown) => record(value) && date(value.from) && date(value.to) && Date.parse(value.from) < Date.parse(value.to) && text(value.timeZone);
const book = (value: unknown) => record(value) && uuid(value.id) && text(value.title);
const copy = (value: Record<string, unknown>) => book(value.book) && text(value.inventoryCode);
const reader = (value: Record<string, unknown>) => record(value.reader) && uuid(value.reader.id) && text(value.reader.fullName);

function inventoryRow(value: unknown): value is InventoryRow {
  return record(value) && book(value) && text(value.author) && text(value.genre)
    && count(value.copies) && typeof value.archived === 'boolean' && count(value.availableForIssue) && counts(value.availability, availability);
}
function rentalRow(value: unknown): value is ReportRental {
  return record(value) && uuid(value.id) && reader(value) && copy(value) && isRentalStatus(value.status)
    && date(value.issuedAt) && date(value.dueAt) && (value.closedAt === null || date(value.closedAt))
    && (value.overdueMs === null || value.status === 'ACTIVE' && count(value.overdueMs) && value.overdueMs !== 0);
}
function chargeRow(value: unknown): value is ChargeRow {
  return record(value) && uuid(value.id) && reader(value) && copy(value) && date(value.closedAt)
    && hasCharges(value) && amounts(value, ['deposit', 'refund', 'topup']);
}
function cashRow(value: unknown): value is CashRow {
  return record(value) && uuid(value.id) && uuid(value.rentalId) && copy(value) && date(value.createdAt)
    && cashTypes.some((type) => value.type === type) && text(value.staffEmail) && isReportMoney(value.amount);
}

export function isInventoryReport(value: unknown): value is InventoryReport {
  return record(value) && value.type === 'inventory' && date(value.generatedAt) && value.period === null
    && record(value.filters) && (value.filters.archived === 'all' || value.filters.archived === 'active' || value.filters.archived === 'archived')
    && optionalText(value.filters.search) && optionalText(value.filters.genre)
    && arrayOf(value.genres, text)
    && record(value.summary) && counts(value.summary, ['editions', 'archivedEditions', 'copies', 'availableForIssue'])
    && counts(value.summary.availability, availability) && counts(value.summary.conditions, conditions) && isPage(value, inventoryRow);
}
export function isRentalsReport(value: unknown): value is RentalsReport {
  return record(value) && value.type === 'rentals' && date(value.generatedAt) && period(value.period)
    && record(value.filters) && (value.filters.dateBy === 'issuedAt' || value.filters.dateBy === 'closedAt')
    && optionalText(value.filters.search) && (value.filters.status === null || isRentalStatus(value.filters.status)) && typeof value.filters.overdue === 'boolean'
    && record(value.summary) && record(value.summary.current) && counts(value.summary.current, ['total', 'overdue'])
    && counts(value.summary.current.byStatus, ['ACTIVE', 'RETURNED', 'LOST']) && counts(value.summary.events, ['issued', 'closed'])
    && isPage(value, rentalRow);
}
export function isFinancialReport(value: unknown): value is FinancialReport {
  return record(value) && value.type === 'financial' && date(value.generatedAt) && period(value.period)
    && record(value.summary) && hasCharges(value.summary.charges) && hasCash(value.summary.cash)
    && record(value.summary.outstanding) && count(value.summary.outstanding.activeRentals) && isReportMoney(value.summary.outstanding.deposits)
    && isPage(value.charges, chargeRow) && isPage(value.cash, cashRow)
    && record(value.trend) && (value.trend.interval === null || value.trend.interval === 'day' || value.trend.interval === 'month')
    && arrayOf(value.trend.data, (row) => record(row) && text(row.bucket) && /^\d{4}-\d{2}-\d{2}$/.test(row.bucket) && date(row.bucket)
      && hasCharges(row) && hasCash(row));
}
export function isDashboard(value: unknown): value is Dashboard {
  return record(value) && date(value.generatedAt) && period(value.period)
    && counts(value.summary, ['editions', 'availableCopies', 'readers', 'maintenanceCopies', 'overdueRentals', 'activeRentals'])
    && hasCharges(value.financial) && record(value.financial) && isReportMoney(value.financial.outstandingDeposits)
    && arrayOf(value.latestIssues, rentalRow) && arrayOf(value.latestClosures, rentalRow) && arrayOf(value.overdue, rentalRow);
}
