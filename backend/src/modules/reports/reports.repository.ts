import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient, RentalStatus } from '../../generated/prisma/client.js';
import type { PaginationQuery } from '../readers/readers.schemas.js';
import type { FinancialQuery, InventoryQuery, RentalsQuery } from './reports.schemas.js';
import { financeInterval, type ReportPeriod } from './report-period.js';

const activeRental = { status: 'ACTIVE' } as const;
const closedStatuses: RentalStatus[] = ['RETURNED', 'LOST'];
const closedRental = { status: { in: closedStatuses } } as const;
const activeBook = { archivedAt: null } as const;
const archivedBook = { archivedAt: { not: null } } as const;
const recentLimit = 5;

const rentalSelect = {
  id: true, status: true, issuedAt: true, dueAt: true, closedAt: true,
  reader: { select: { id: true, fullName: true } },
  copy: { select: { inventoryCode: true, book: { select: { id: true, title: true } } } },
} satisfies Prisma.RentalSelect;
export type ReportRental = Prisma.RentalGetPayload<{ select: typeof rentalSelect }>;

const literal = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const contains = (value: string) => ({ contains: literal(value), mode: 'insensitive' as const });
const slice = ({ page, pageSize }: PaginationQuery) => ({ skip: (page - 1) * pageSize, take: pageSize });
const bounds = (period: ReportPeriod) => ({ gte: period.from, lt: period.to });
const overdue = (now: Date) => ({ ...activeRental, dueAt: { lt: now } });
const closedIn = (period: ReportPeriod) => ({ ...closedRental, closedAt: bounds(period) });

export type FinanceBucket = {
  bucket: string; rentalFee: Prisma.Decimal; damageFine: Prisma.Decimal;
  depositIn: Prisma.Decimal; refundOut: Prisma.Decimal; topupIn: Prisma.Decimal;
};

export class PrismaReportsData {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async inventory(query: InventoryQuery) {
    const search = query.search && contains(query.search);
    const catalogue: Prisma.BookWhereInput = {
      ...(query.archived === 'active' && activeBook),
      ...(query.archived === 'archived' && archivedBook),
      ...(search && { OR: [{ title: search }, { author: search }, { genre: search }] }),
    };
    const where: Prisma.BookWhereInput = {
      ...catalogue,
      ...(query.genre && { genre: { equals: literal(query.genre), mode: 'insensitive' } }),
    };
    const books = await this.db.book.findMany({
      where, select: { id: true, title: true, author: true, genre: true, archivedAt: true },
      orderBy: [{ title: 'asc' }, { id: 'asc' }], ...slice(query),
    });
    const editions = await this.db.book.count({ where });
    const archivedEditions = await this.db.book.count({ where: { AND: [where, archivedBook] } });
    const genreGroups = await this.db.book.groupBy({ by: ['genre'], where: catalogue, orderBy: { genre: 'asc' } });
    const availableForIssue = await this.db.bookCopy.count({ where: { status: 'AVAILABLE', book: { AND: [where, activeBook] } } });
    const copyGroups = await this.db.bookCopy.groupBy({ by: ['status', 'condition'], where: { book: where }, _count: { _all: true } });
    const pageGroups = books.length ? await this.db.bookCopy.groupBy({
      by: ['bookId', 'status'], where: { bookId: { in: books.map(({ id }) => id) } }, _count: { _all: true },
    }) : [];
    return { books, editions, archivedEditions, genreGroups, availableForIssue, copyGroups, pageGroups };
  }

  async rentals(query: RentalsQuery, period: ReportPeriod, now: Date) {
    const search = query.search && contains(query.search);
    const where: Prisma.RentalWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.overdue && { AND: [overdue(now)] }),
      ...(search && { OR: [
        { reader: { fullName: search } },
        { copy: { inventoryCode: search } },
        { copy: { book: { OR: [{ title: search }, { author: search }] } } },
      ] }),
    };
    const issued = { AND: [where, { issuedAt: bounds(period) }] };
    const closed = { AND: [where, closedIn(period)] };
    const tableWhere = query.dateBy === 'issuedAt' ? issued : closed;
    const items = await this.db.rental.findMany({
      where: tableWhere, select: rentalSelect, ...slice(query), orderBy: [{ [query.dateBy]: 'desc' }, { id: 'desc' }],
    });
    const states = await this.db.rental.groupBy({ by: ['status'], where, _count: { _all: true } });
    const overdueCount = await this.db.rental.count({ where: { AND: [where, overdue(now)] } });
    const issuedCount = await this.db.rental.count({ where: issued });
    const closedCount = await this.db.rental.count({ where: closed });
    return { items, states, overdueCount, issuedCount, closedCount };
  }

  private charges(period: ReportPeriod) {
    return this.db.rental.aggregate({
      where: closedIn(period), _count: { _all: true }, _sum: { rentalFee: true, damageFine: true },
    });
  }

  private liability() {
    return this.db.rental.aggregate({ where: activeRental, _count: { _all: true }, _sum: { depositSnapshot: true } });
  }

  async financial(query: FinancialQuery, period: ReportPeriod) {
    const chargeWhere = closedIn(period);
    const cashWhere = { createdAt: bounds(period) };
    const charges = await this.charges(period);
    const liability = await this.liability();
    const cashGroups = await this.db.cashMovement.groupBy({ by: ['type'], where: cashWhere, _sum: { amount: true }, _count: { _all: true } });
    const closedRows = await this.db.rental.findMany({
      where: chargeWhere,
      select: { ...rentalSelect, rentalFee: true, damageFine: true, depositSnapshot: true, refundAmount: true, additionalPayment: true },
      orderBy: [{ closedAt: 'desc' }, { id: 'desc' }], ...slice({ page: query.chargesPage, pageSize: query.pageSize }),
    });
    const cashRows = await this.db.cashMovement.findMany({
      where: cashWhere, select: {
        id: true, type: true, amount: true, createdAt: true, recordedBy: { select: { email: true } },
        rental: { select: { id: true, copy: rentalSelect.copy } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...slice({ page: query.cashPage, pageSize: query.pageSize }),
    });
    const buckets = await this.buckets(period);
    return { charges, liability, cashGroups, closedRows, cashRows, buckets };
  }

  private async buckets({ from, to, timeZone }: ReportPeriod) {
    const interval = financeInterval({ from, to, timeZone });
    if (!interval) return { interval, items: [] as FinanceBucket[] };
    const items = await this.db.$queryRaw<FinanceBucket[]>`
      SELECT to_char(bucket, 'YYYY-MM-DD') AS bucket,
        COALESCE(SUM(fee), 0) AS "rentalFee", COALESCE(SUM(fine), 0) AS "damageFine",
        COALESCE(SUM(deposit), 0) AS "depositIn", COALESCE(SUM(refund), 0) AS "refundOut",
        COALESCE(SUM(topup), 0) AS "topupIn"
      FROM (
        SELECT date_trunc(${interval}, timezone(${timeZone}, "closedAt")) AS bucket,
          SUM("rentalFee") AS fee, SUM("damageFine") AS fine,
          0::numeric AS deposit, 0::numeric AS refund, 0::numeric AS topup
        FROM "Rental"
        WHERE "closedAt" >= ${from} AND "closedAt" < ${to}
          AND "status" IN (${Prisma.join(closedStatuses.map((status) => Prisma.sql`${status}::"RentalStatus"`))})
        GROUP BY 1
        UNION ALL
        SELECT date_trunc(${interval}, timezone(${timeZone}, "createdAt")) AS bucket,
          0::numeric, 0::numeric,
          SUM("amount") FILTER (WHERE "type" = 'DEPOSIT_IN'),
          SUM("amount") FILTER (WHERE "type" = 'REFUND_OUT'),
          SUM("amount") FILTER (WHERE "type" = 'TOPUP_IN')
        FROM "CashMovement"
        WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
        GROUP BY 1
      ) movements
      GROUP BY movements.bucket
      ORDER BY movements.bucket
    `;
    return { interval, items };
  }

  async dashboard(period: ReportPeriod, now: Date) {
    const editions = await this.db.book.count({ where: activeBook });
    const availableCopies = await this.db.bookCopy.count({ where: { book: activeBook, status: 'AVAILABLE' } });
    const readers = await this.db.reader.count();
    const maintenanceCopies = await this.db.bookCopy.count({ where: { status: 'MAINTENANCE' } });
    const overdueRentals = await this.db.rental.count({ where: overdue(now) });
    const charges = await this.charges(period);
    const liability = await this.liability();
    const latestIssues = await this.db.rental.findMany({
      select: rentalSelect, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], take: recentLimit,
    });
    const latestClosures = await this.db.rental.findMany({
      where: { ...closedRental, closedAt: { not: null } },
      select: rentalSelect, orderBy: [{ closedAt: 'desc' }, { id: 'desc' }], take: recentLimit,
    });
    const overdueItems = await this.db.rental.findMany({
      where: overdue(now), select: rentalSelect, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: recentLimit,
    });
    return { editions, availableCopies, readers, maintenanceCopies, overdueRentals, charges, liability, latestIssues, latestClosures, overdueItems };
  }
}

export type ReportsData = Pick<PrismaReportsData, 'inventory' | 'rentals' | 'financial' | 'dashboard'>;

export interface ReportsRepository {
  read<T>(operation: (data: ReportsData) => Promise<T>): Promise<T>;
}

export class PrismaReportsRepository implements ReportsRepository {
  constructor(private readonly database?: PrismaClient) {}

  async read<T>(operation: (data: ReportsData) => Promise<T>) {
    const db = this.database ?? (await import('../../lib/prisma.js')).prisma;
    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return operation(new PrismaReportsData(tx));
    }, { isolationLevel: 'RepeatableRead' });
  }
}
