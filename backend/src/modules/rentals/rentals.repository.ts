import { Prisma } from '../../generated/prisma/client.js';
import type { BookCopy, DamageRule, PrismaClient, Rental } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import { lockBookForCopyWrite, lockBookCopyForWrite } from '../../lib/book-copy-locks.js';
import type { ListRentalsQuery } from './rentals.schemas.js';

const rentalSummarySelect = {
  id: true, status: true, issuedAt: true, dueAt: true, closedAt: true,
  reader: { select: { id: true, fullName: true } },
  copy: { select: {
    id: true, inventoryCode: true, status: true, condition: true, conditionNotes: true,
    book: { select: { id: true, title: true, author: true } },
  } },
} satisfies Prisma.RentalSelect;
const staffSelect = { id: true, email: true, role: true } as const;
const rentalDetailsSelect = {
  ...rentalSummarySelect,
  issuedBy: { select: staffSelect }, closedBy: { select: staffSelect },
  pricePerDaySnapshot: true, depositSnapshot: true, discountPercentSnapshot: true, readerCategorySnapshot: true,
  rentalFee: true, damageFine: true, damagePercentSnapshot: true, damageRuleId: true, refundAmount: true, additionalPayment: true,
  conditionAtIssue: true, conditionNotesAtIssue: true, conditionAtReturn: true, conditionNotesAtReturn: true, newDamageNotes: true,
  damageRule: { select: { id: true, code: true, label: true } },
  cashMovements: {
    orderBy: [{ createdAt: 'asc' }, { type: 'asc' }, { id: 'asc' }],
    select: { id: true, type: true, amount: true, createdAt: true, recordedBy: { select: staffSelect } },
  },
} satisfies Prisma.RentalSelect;

export type RentalSummary = Prisma.RentalGetPayload<{ select: typeof rentalSummarySelect }>;
export type RentalDetails = Prisma.RentalGetPayload<{ select: typeof rentalDetailsSelect }>;
export type RentalForReturn = Rental & { copy: Pick<BookCopy, 'bookId' | 'status'> };
type Closure = Required<Pick<Prisma.RentalUncheckedUpdateInput,
  'status' | 'closedAt' | 'closedById' | 'rentalFee' | 'damageFine' | 'damagePercentSnapshot' | 'damageRuleId' | 'refundAmount' | 'additionalPayment'
  | 'conditionAtReturn' | 'conditionNotesAtReturn' | 'newDamageNotes'>>;
type CopyUpdate = Pick<BookCopy, 'status' | 'condition' | 'conditionNotes'>;

export interface RentalsReadData {
  list(query: ListRentalsQuery, now: Date): Promise<{ items: RentalSummary[]; total: number }>;
  details(id: string): Promise<RentalDetails | null>;
  findForReturn(id: string): Promise<RentalForReturn | null>;
  findDamageRule(code: string): Promise<DamageRule | null>;
}

export interface RentalsWriteData extends RentalsReadData {
  readerTerms(id: string): Promise<{ name: string; discountPercent: Prisma.Decimal } | null>;
  copyBookId(id: string): Promise<string | null>;
  lockBook(id: string): ReturnType<typeof lockBookForCopyWrite>;
  lockCopy(bookId: string, copyId: string): ReturnType<typeof lockBookCopyForWrite>;
  hasActiveRental(copyId: string): Promise<boolean>;
  issue(input: Prisma.RentalUncheckedCreateInput): Promise<Rental>;
  close(id: string, input: Closure): Promise<void>;
  updateCopy(copy: BookCopy, data: CopyUpdate): Promise<void>;
  recordCash(input: Prisma.CashMovementUncheckedCreateInput): Promise<void>;
}

export interface RentalsRepository {
  read<T>(operation: (data: RentalsReadData) => Promise<T>): Promise<T>;
  transaction<T>(operation: (data: RentalsWriteData) => Promise<T>): Promise<T>;
  damageRules(): Promise<DamageRule[]>;
}

export const rentalWriteConflict = () =>
  new ApiError(409, 'RENTAL_WRITE_CONFLICT', 'Дані прокату або примірника змінюються. Оновіть дані');

class PrismaRentalsData implements RentalsWriteData {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async list(query: ListRentalsQuery, now: Date) {
    const contains = query.search && { contains: query.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' as const };
    const overdue = { status: 'ACTIVE', dueAt: { lt: now } } as const;
    const where: Prisma.RentalWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.readerId && { readerId: query.readerId }),
      ...(query.bookId && { copy: { bookId: query.bookId } }),
      ...(query.overdue === true && { AND: [overdue] }),
      ...(query.overdue === false && { NOT: overdue }),
      ...(contains && { OR: [
        { reader: { fullName: contains } },
        { copy: { inventoryCode: contains } },
        { copy: { book: { OR: [{ title: contains }, { author: contains }] } } },
      ] }),
    };
    const items = await this.db.rental.findMany({
      where, select: rentalSummarySelect,
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize,
    });
    return { items, total: await this.db.rental.count({ where }) };
  }

  details(id: string) {
    return this.db.rental.findUnique({ where: { id }, select: rentalDetailsSelect });
  }

  findForReturn(id: string) {
    return this.db.rental.findUnique({ where: { id }, include: { copy: { select: { bookId: true, status: true } } } });
  }

  findDamageRule(code: string) {
    return this.db.damageRule.findUnique({ where: { code } });
  }

  async readerTerms(id: string) {
    const [category] = await this.db.$queryRaw<{ name: string; discountPercent: Prisma.Decimal }[]>`
      SELECT c."name", c."discountPercent" FROM "Reader" r
      JOIN "ReaderCategory" c ON c."id" = r."categoryId"
      WHERE r."id" = ${id}::uuid FOR SHARE OF r, c NOWAIT
    `;
    return category ?? null;
  }

  async copyBookId(id: string) {
    const copy = await this.db.bookCopy.findUnique({ where: { id }, select: { bookId: true } });
    return copy?.bookId ?? null;
  }

  lockBook(id: string) { return lockBookForCopyWrite(this.db, id); }
  lockCopy(bookId: string, copyId: string) { return lockBookCopyForWrite(this.db, bookId, copyId); }

  async hasActiveRental(copyId: string) {
    return await this.db.rental.findFirst({ where: { copyId, status: 'ACTIVE' }, select: { id: true } }) !== null;
  }

  issue(data: Prisma.RentalUncheckedCreateInput) {
    return this.db.rental.create({ data });
  }

  async close(id: string, data: Closure) {
    const { count } = await this.db.rental.updateMany({ where: { id, status: 'ACTIVE' }, data });
    if (count !== 1) throw rentalWriteConflict();
  }

  async updateCopy(copy: BookCopy, data: CopyUpdate) {
    const { count } = await this.db.bookCopy.updateMany({ where: { id: copy.id, status: copy.status }, data });
    if (count !== 1) throw rentalWriteConflict();
  }

  async recordCash(data: Prisma.CashMovementUncheckedCreateInput) {
    await this.db.cashMovement.create({ data });
  }
}

export class PrismaRentalsRepository implements RentalsRepository {
  constructor(private readonly database?: PrismaClient) {}

  private async db() {
    return this.database ?? (await import('../../lib/prisma.js')).prisma;
  }

  async read<T>(operation: (data: RentalsReadData) => Promise<T>) {
    const db = await this.db();
    return db.$transaction((tx) => operation(new PrismaRentalsData(tx)), { isolationLevel: 'RepeatableRead' });
  }

  async transaction<T>(operation: (data: RentalsWriteData) => Promise<T>) {
    const db = await this.db();
    try {
      return await db.$transaction((tx) => operation(new PrismaRentalsData(tx)), { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
        const sqlState = String(error.meta?.code ?? adapter?.cause?.originalCode);
        if (['P2002', 'P2003', 'P2034', 'P2025'].includes(error.code)
          || (error.code === 'P2010' && ['55P03', '40001', '40P01'].includes(sqlState))) throw rentalWriteConflict();
      }
      throw error;
    }
  }

  async damageRules() {
    return (await this.db()).damageRule.findMany({ orderBy: [{ penaltyPercent: 'asc' }, { code: 'asc' }] });
  }
}
