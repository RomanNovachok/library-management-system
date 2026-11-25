import { Prisma } from '../../generated/prisma/client.js';

export interface DiscountStrategy {
  apply(baseFee: Prisma.Decimal): Prisma.Decimal;
}

export class NoDiscountStrategy implements DiscountStrategy {
  apply(baseFee: Prisma.Decimal) {
    return baseFee;
  }
}

export class PercentageDiscountStrategy implements DiscountStrategy {
  constructor(private readonly percent: Prisma.Decimal) {}

  apply(baseFee: Prisma.Decimal) {
    return baseFee.times(new Prisma.Decimal(100).minus(this.percent)).div(100);
  }
}
