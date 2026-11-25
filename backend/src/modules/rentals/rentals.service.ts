import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import type { CopyStatus, DamageRule, Rental } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import { NoDiscountStrategy, PercentageDiscountStrategy } from './discount-strategy.js';
import { billableDays, RentalCalculator } from './rental-calculator.js';
import { conditionForIssue, conditionForReturn } from './rental-condition.js';
import type { RentalEventPublisher } from './rental-events.js';
import type { RentalDetails, RentalForReturn, RentalSummary, RentalsReadData, RentalsRepository } from './rentals.repository.js';
import type { CloseRentalInput, IssueRentalInput, ListRentalsQuery, ReturnPreviewInput } from './rentals.schemas.js';

const missingRental = () => new ApiError(404, 'RENTAL_NOT_FOUND', 'Прокат не знайдено');
const missingCopy = () => new ApiError(404, 'COPY_NOT_FOUND', 'Примірник не знайдено');
const copyUnavailable = () => new ApiError(409, 'RENTAL_COPY_UNAVAILABLE', 'Примірник недоступний для видачі');
const fingerprint = (value: object) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function ruleJson(rule: DamageRule) {
  return { ...rule, penaltyPercent: rule.penaltyPercent.toFixed(2) };
}

function summaryJson<T extends RentalSummary>(rental: T, now: Date) {
  return { ...rental, overdue: rental.status === 'ACTIVE' && now > rental.dueAt };
}

function detailsJson(rental: RentalDetails, now: Date) {
  return {
    ...summaryJson(rental, now),
    pricePerDaySnapshot: rental.pricePerDaySnapshot.toFixed(2),
    depositSnapshot: rental.depositSnapshot.toFixed(2),
    discountPercentSnapshot: rental.discountPercentSnapshot.toFixed(2),
    rentalFee: rental.rentalFee?.toFixed(2) ?? null,
    damageFine: rental.damageFine?.toFixed(2) ?? null,
    damagePercentSnapshot: rental.damagePercentSnapshot?.toFixed(2) ?? null,
    refundAmount: rental.refundAmount?.toFixed(2) ?? null,
    additionalPayment: rental.additionalPayment?.toFixed(2) ?? null,
    billableDays: rental.closedAt ? billableDays(rental.issuedAt, rental.closedAt) : null,
    cashMovements: rental.cashMovements.map((movement) => ({ ...movement, amount: movement.amount.toFixed(2) })),
  };
}

function requireDetails(rental: RentalDetails | null) {
  if (!rental) throw missingRental();
  return rental;
}

function requireActive(rental: RentalForReturn | null) {
  if (!rental) throw missingRental();
  if (rental.status !== 'ACTIVE') throw new ApiError(409, 'RENTAL_ALREADY_CLOSED', 'Прокат уже закрито');
  return rental;
}

async function calculateSettlement(db: RentalsReadData, rental: Rental, closedAt: Date, input: ReturnPreviewInput) {
  const { ruleCode, copyStatus, condition, conditionNotes, newDamageNotes } = conditionForReturn(rental, input);
  const rule = await db.findDamageRule(ruleCode);
  if (!rule) throw new ApiError(404, 'DAMAGE_RULE_NOT_FOUND', 'Правило пошкодження не знайдено');
  const status: 'LOST' | 'RETURNED' = condition === 'LOST' ? 'LOST' : 'RETURNED';
  const penaltyPercent = ruleCode === 'NONE' ? new Prisma.Decimal(0) : rule.penaltyPercent;
  const discount = rental.discountPercentSnapshot.isZero()
    ? new NoDiscountStrategy()
    : new PercentageDiscountStrategy(rental.discountPercentSnapshot);
  const amounts = new RentalCalculator(discount).calculate(rental, { penaltyPercent }, closedAt);
  const quote = {
    rentalId: rental.id, damageRuleId: rule.id, copyStatus, status, condition, conditionNotes, newDamageNotes,
    billableDays: amounts.billableDays, damagePercent: penaltyPercent.toFixed(2),
    deposit: amounts.deposit.toFixed(2), rentalFee: amounts.rentalFee.toFixed(2),
    damageFine: amounts.damageFine.toFixed(2), charges: amounts.charges.toFixed(2),
    refundAmount: amounts.refundAmount.toFixed(2), additionalPayment: amounts.additionalPayment.toFixed(2),
  } as const;
  const previewVersion = fingerprint(quote);
  return { amounts, quote: { ...quote, previewVersion }, penaltyPercent, ruleCode };
}

export class RentalsService {
  constructor(
    private readonly repository: RentalsRepository,
    private readonly events: RentalEventPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(query: ListRentalsQuery) {
    const now = this.now();
    const { items, total } = await this.repository.read((db) => db.list(query, now));
    return {
      data: items.map((item) => summaryJson(item, now)),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    };
  }

  async details(id: string) {
    return this.repository.read(async (db) => detailsJson(requireDetails(await db.details(id)), this.now()));
  }

  async damageRules() {
    return (await this.repository.damageRules()).map(ruleJson);
  }

  async issue(input: IssueRentalInput, actorId: string, termsVersion?: string) {
    const rental = await this.repository.transaction(async (db) => {
      const bookId = await db.copyBookId(input.copyId);
      if (!bookId) throw missingCopy();
      const book = await db.lockBook(bookId);
      if (!book) throw new ApiError(404, 'BOOK_NOT_FOUND', 'Книгу не знайдено');
      if (book.archivedAt) throw new ApiError(409, 'BOOK_ARCHIVED', 'Архівовану книгу видавати заборонено');
      const copy = await db.lockCopy(bookId, input.copyId);
      if (!copy) throw missingCopy();
      if (copy.status !== 'AVAILABLE' || await db.hasActiveRental(copy.id)) throw copyUnavailable();
      const category = await db.readerTerms(input.readerId);
      if (!category) throw new ApiError(404, 'READER_NOT_FOUND', 'Читача не знайдено');
      if (termsVersion && termsVersion !== fingerprint([
        input.readerId, copy.id, book.dailyPrice.toFixed(2), book.depositAmount.toFixed(2), category.name, category.discountPercent.toFixed(2),
        copy.condition, copy.conditionNotes,
      ])) {
        throw new ApiError(409, 'RENTAL_ISSUE_TERMS_CHANGED', 'Умови видачі змінилися. Перевірте заставу та фізичний стан');
      }
      const inspected = conditionForIssue(copy, input.inspection);

      const issuedAt = this.now();
      if (!Number.isFinite(input.dueAt.getTime()) || input.dueAt <= issuedAt) {
        throw new ApiError(400, 'RENTAL_DUE_DATE_INVALID', 'Дата повернення має бути пізнішою за час видачі');
      }
      const created = await db.issue({
        readerId: input.readerId, copyId: copy.id, dueAt: input.dueAt, issuedAt, issuedById: actorId, status: 'ACTIVE',
        pricePerDaySnapshot: book.dailyPrice, depositSnapshot: book.depositAmount,
        discountPercentSnapshot: category.discountPercent, readerCategorySnapshot: category.name,
        conditionAtIssue: inspected.condition, conditionNotesAtIssue: inspected.conditionNotes,
      });
      await db.updateCopy(copy, { status: 'RENTED', ...inspected });
      await db.recordCash({ rentalId: created.id, recordedById: actorId, createdAt: issuedAt, type: 'DEPOSIT_IN', amount: book.depositAmount });
      return requireDetails(await db.details(created.id));
    });
    await this.events.publish({ type: 'RENTAL_ISSUED', rentalId: rental.id, actorId, occurredAt: rental.issuedAt });
    return detailsJson(rental, rental.issuedAt);
  }

  async preview(id: string, input: ReturnPreviewInput) {
    return this.repository.read(async (db) => {
      const rental = requireActive(await db.findForReturn(id));
      this.assertRentedCopy(rental.copy.status);
      return (await calculateSettlement(db, rental, this.now(), input)).quote;
    });
  }

  async close(id: string, input: CloseRentalInput, actorId: string) {
    const settled = await this.repository.transaction(async (db) => {
      const beforeLock = requireActive(await db.findForReturn(id));
      // Archived books can still be returned. The lock order matches issuance and BookCopy CRUD.
      await db.lockBook(beforeLock.copy.bookId);
      const copy = await db.lockCopy(beforeLock.copy.bookId, beforeLock.copyId);
      if (!copy) throw missingCopy();
      const rental = requireActive(await db.findForReturn(id));
      this.assertRentedCopy(copy.status);
      const closedAt = this.now();
      const { amounts, quote, penaltyPercent, ruleCode } = await calculateSettlement(db, rental, closedAt, input);
      if (input.previewVersion !== quote.previewVersion) {
        throw new ApiError(409, 'RENTAL_PREVIEW_CHANGED', 'Розрахунок змінився. Отримайте новий розрахунок');
      }
      const { status, copyStatus, condition, conditionNotes, newDamageNotes, damageRuleId } = quote;
      const { rentalFee, damageFine, refundAmount, additionalPayment } = amounts;
      await db.close(id, {
        status, closedAt, closedById: actorId, rentalFee, damageFine, damageRuleId,
        damagePercentSnapshot: penaltyPercent, refundAmount, additionalPayment,
        conditionAtReturn: condition, conditionNotesAtReturn: conditionNotes, newDamageNotes,
      });
      await db.updateCopy(copy, { status: copyStatus, condition, conditionNotes });
      const cash = { rentalId: id, recordedById: actorId, createdAt: closedAt };
      if (refundAmount.gt(0)) {
        await db.recordCash({ ...cash, type: 'REFUND_OUT', amount: refundAmount });
      } else if (additionalPayment.gt(0)) {
        await db.recordCash({ ...cash, type: 'TOPUP_IN', amount: additionalPayment });
      }
      return { rental: requireDetails(await db.details(id)), closedAt, status, copyStatus, damageRuleId, condition, ruleCode, damagePercent: quote.damagePercent };
    });
    const { rental, closedAt, ...audit } = settled;
    await this.events.publish({ type: 'RENTAL_CLOSED', rentalId: id, actorId, occurredAt: closedAt, ...audit, conditionAtIssue: rental.conditionAtIssue });
    return detailsJson(rental, closedAt);
  }

  private assertRentedCopy(status: CopyStatus) {
    if (status !== 'RENTED') throw new ApiError(409, 'RENTAL_COPY_STATE_CONFLICT', 'Стан примірника не відповідає активному прокату');
  }

}
