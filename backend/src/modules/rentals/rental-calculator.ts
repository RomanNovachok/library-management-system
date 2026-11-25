import { Prisma } from '../../generated/prisma/client.js';
import type { Rental, DamageRule } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import type { DiscountStrategy } from './discount-strategy.js';

const dayMs = 24 * 60 * 60 * 1000;
const moneyLimit = new Prisma.Decimal('9999999999.99');
const zero = new Prisma.Decimal(0);

function checkedMoney(value: Prisma.Decimal) {
  const rounded = value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (!value.isFinite() || value.lt(0) || rounded.gt(moneyLimit)) {
    throw new ApiError(409, 'RENTAL_AMOUNT_OUT_OF_RANGE', 'Грошова сума виходить за допустимі межі');
  }
  return rounded;
}

export function billableDays(issuedAt: Date, closedAt: Date) {
  const elapsed = closedAt.getTime() - issuedAt.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    throw new ApiError(409, 'RENTAL_CLOCK_CONFLICT', 'Час повернення передує часу видачі');
  }
  return Math.max(1, Math.ceil(elapsed / dayMs));
}

type RentalTerms = Pick<Rental, 'issuedAt' | 'pricePerDaySnapshot' | 'depositSnapshot'>;

export class RentalCalculator {
  constructor(private readonly discount: DiscountStrategy) {}

  calculate(rental: RentalTerms, rule: Pick<DamageRule, 'penaltyPercent'>, closedAt: Date) {
    const days = billableDays(rental.issuedAt, closedAt);
    const deposit = checkedMoney(rental.depositSnapshot);
    const rentalFee = checkedMoney(this.discount.apply(rental.pricePerDaySnapshot.times(days)));
    const damageFine = checkedMoney(deposit.times(rule.penaltyPercent).div(100));
    const charges = rentalFee.plus(damageFine);
    return {
      billableDays: days, deposit, rentalFee, damageFine, charges,
      refundAmount: checkedMoney(Prisma.Decimal.max(deposit.minus(charges), zero)),
      additionalPayment: checkedMoney(Prisma.Decimal.max(charges.minus(deposit), zero)),
    };
  }
}
