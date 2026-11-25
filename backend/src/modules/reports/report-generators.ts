import { BaseReport } from './base-report.js';
import { amountStrings, cashTotals, chargeTotals, money, pagination, rentalJson } from './report-format.js';
import { periodJson, type ReportPeriod } from './report-period.js';
import type { FinancialQuery, InventoryQuery, RentalsQuery } from './reports.schemas.js';
import type { ReportsData, ReportsRepository } from './reports.repository.js';

type Timed<Q> = { query: Q; now: Date };
type Periodic<Q> = Timed<Q> & { period: ReportPeriod };
type ReportData<Key extends keyof ReportsData> = Awaited<ReturnType<ReportsData[Key]>>;
type InventoryData = Timed<InventoryQuery> & ReportData<'inventory'>;
type RentalsData = Periodic<RentalsQuery> & ReportData<'rentals'>;
type FinancialData = Periodic<FinancialQuery> & ReportData<'financial'>;

const copyCounts = () => ({ AVAILABLE: 0, RENTED: 0, MAINTENANCE: 0, LOST: 0 });
type CopyCounts = ReturnType<typeof copyCounts>;

function aggregateInventory({ books, editions, archivedEditions, genreGroups, availableForIssue, copyGroups, pageGroups, query, now }: InventoryData) {
  const availability = copyCounts();
  const conditions = { GOOD: 0, MINOR_DAMAGE: 0, MAJOR_DAMAGE: 0, LOST: 0, UNKNOWN: 0 };
  let copies = 0;
  for (const { status, condition, _count } of copyGroups) {
    availability[status] += _count._all;
    conditions[condition] += _count._all;
    copies += _count._all;
  }
  const byBook = new Map<string, { copies: number; availability: CopyCounts }>();
  for (const { bookId, status, _count } of pageGroups) {
    const counts = byBook.get(bookId) ?? { copies: 0, availability: copyCounts() };
    counts.copies += _count._all;
    counts.availability[status] += _count._all;
    byBook.set(bookId, counts);
  }
  const rows = books.map(({ archivedAt, ...book }) => {
    const counts = byBook.get(book.id) ?? { copies: 0, availability: copyCounts() };
    return { ...book, ...counts, archived: archivedAt !== null, availableForIssue: archivedAt === null ? counts.availability.AVAILABLE : 0 };
  });
  const genres = new Map<string, string>();
  for (const { genre } of genreGroups) {
    const key = genre.toLowerCase();
    if (!genres.has(key)) genres.set(key, genre);
  }
  return { query, now, rows, genres: [...genres.values()], summary: { editions, archivedEditions, copies, availableForIssue, availability, conditions } };
}

function formatInventory({ query, now, rows, genres, summary }: ReturnType<typeof aggregateInventory>) {
  const { archived, genre, search } = query;
  return {
    type: 'inventory' as const, generatedAt: now.toISOString(), period: null,
    filters: { archived, genre: genre ?? null, search: search ?? null },
    data: rows, genres, summary, pagination: pagination(query, summary.editions),
  };
}

export class InventoryReport extends BaseReport<Timed<InventoryQuery>, InventoryData, ReturnType<typeof aggregateInventory>, ReturnType<typeof formatInventory>> {
  constructor(private readonly repository: ReportsRepository) { super(); }
  protected async fetchData(params: Timed<InventoryQuery>) {
    return { ...params, ...await this.repository.read((db) => db.inventory(params.query)) };
  }
  protected aggregate = aggregateInventory;
  protected format = formatInventory;
}

function aggregateRentals({ query, now, period, items, states, overdueCount, issuedCount, closedCount }: RentalsData) {
  const byStatus = { ACTIVE: 0, RETURNED: 0, LOST: 0 };
  let total = 0;
  for (const { status, _count } of states) {
    byStatus[status] = _count._all;
    total += _count._all;
  }
  const summary = { current: { total, byStatus, overdue: overdueCount }, events: { issued: issuedCount, closed: closedCount } };
  return { query, now, period, items, summary };
}

function formatRentals({ query, now, period, items, summary }: ReturnType<typeof aggregateRentals>) {
  const { dateBy, search, status, overdue } = query;
  return {
    type: 'rentals' as const, generatedAt: now.toISOString(), period: periodJson(period),
    filters: { dateBy, search: search ?? null, status: status ?? null, overdue },
    summary, data: items.map((item) => rentalJson(item, now)),
    pagination: pagination(query, dateBy === 'issuedAt' ? summary.events.issued : summary.events.closed),
  };
}

export class RentalsReport extends BaseReport<Periodic<RentalsQuery>, RentalsData, ReturnType<typeof aggregateRentals>, ReturnType<typeof formatRentals>> {
  constructor(private readonly repository: ReportsRepository) { super(); }
  protected async fetchData(params: Periodic<RentalsQuery>) {
    return { ...params, ...await this.repository.read((db) => db.rentals(params.query, params.period, params.now)) };
  }
  protected aggregate = aggregateRentals;
  protected format = formatRentals;
}

function aggregateFinancial({ query, now, period, charges, liability, cashGroups, closedRows, cashRows, buckets }: FinancialData) {
  const byType = new Map(cashGroups.map(({ type, _sum }) => [type, _sum.amount]));
  const summary = {
    charges: chargeTotals(charges._sum.rentalFee, charges._sum.damageFine),
    cash: cashTotals(byType.get('DEPOSIT_IN'), byType.get('REFUND_OUT'), byType.get('TOPUP_IN')),
    outstanding: { activeRentals: liability._count._all, deposits: liability._sum.depositSnapshot },
  };
  const cashCount = cashGroups.reduce((total, group) => total + group._count._all, 0);
  const trend = {
    interval: buckets.interval,
    data: buckets.items.map(({ bucket, rentalFee, damageFine, depositIn, refundOut, topupIn }) =>
      ({ bucket, amounts: { ...chargeTotals(rentalFee, damageFine), ...cashTotals(depositIn, refundOut, topupIn) } })),
  };
  const closedItems = closedRows.map(({ rentalFee, damageFine, ...row }) => ({ ...row, charges: chargeTotals(rentalFee, damageFine) }));
  return { query, now, period, summary, closedItems, closedCount: charges._count._all, cashRows, cashCount, trend };
}

function formatFinancial({ query, now, period, summary, closedItems, closedCount, cashRows, cashCount, trend }: ReturnType<typeof aggregateFinancial>) {
  const { pageSize, chargesPage, cashPage } = query;
  return {
    type: 'financial' as const, generatedAt: now.toISOString(), period: periodJson(period),
    summary: {
      charges: amountStrings(summary.charges), cash: amountStrings(summary.cash),
      outstanding: { ...summary.outstanding, deposits: money(summary.outstanding.deposits) },
    },
    trend: { interval: trend.interval, data: trend.data.map(({ bucket, amounts }) => ({ bucket, ...amountStrings(amounts) })) },
    charges: {
      pagination: pagination({ page: chargesPage, pageSize }, closedCount),
      data: closedItems.map(({ id, copy, reader, closedAt, charges, depositSnapshot, refundAmount, additionalPayment }) => ({
        id, ...copy, reader, closedAt: closedAt!.toISOString(),
        ...amountStrings(charges), deposit: money(depositSnapshot),
        refund: money(refundAmount), topup: money(additionalPayment),
      })),
    },
    cash: {
      pagination: pagination({ page: cashPage, pageSize }, cashCount),
      data: cashRows.map(({ id, type, amount, createdAt, rental, recordedBy }) => ({
        id, type, amount: money(amount), createdAt: createdAt.toISOString(),
        rentalId: rental.id, ...rental.copy, staffEmail: recordedBy.email,
      })),
    },
  };
}

export class FinancialReport extends BaseReport<Periodic<FinancialQuery>, FinancialData, ReturnType<typeof aggregateFinancial>, ReturnType<typeof formatFinancial>> {
  constructor(private readonly repository: ReportsRepository) { super(); }
  protected async fetchData(params: Periodic<FinancialQuery>) {
    return { ...params, ...await this.repository.read((db) => db.financial(params.query, params.period)) };
  }
  protected aggregate = aggregateFinancial;
  protected format = formatFinancial;
}
