import { Prisma } from '../../generated/prisma/client.js';
import type { PaginationQuery } from '../readers/readers.schemas.js';
import type { ReportRental } from './reports.repository.js';

// Allow totals wider than an individual Numeric(12,2) entry, including on addition/subtraction.
const TotalDecimal = Prisma.Decimal.clone({ precision: 40 });
const decimal = (value: Prisma.Decimal | null | undefined) => new TotalDecimal(value ?? 0);
export const money = (value: Prisma.Decimal | null | undefined) => decimal(value).toFixed(2);

export function chargeTotals(rentalFee: Prisma.Decimal | null, damageFine: Prisma.Decimal | null) {
  const fee = decimal(rentalFee);
  const fine = decimal(damageFine);
  return { rentalFee: fee, damageFine: fine, totalCharges: fee.plus(fine) };
}

export function cashTotals(
  deposit: Prisma.Decimal | null | undefined, refund: Prisma.Decimal | null | undefined, topup: Prisma.Decimal | null | undefined,
) {
  const depositIn = decimal(deposit);
  const refundOut = decimal(refund);
  const topupIn = decimal(topup);
  const inflow = depositIn.plus(topupIn);
  return { depositIn, refundOut, topupIn, inflow, outflow: refundOut, netCash: inflow.minus(refundOut) };
}

export function amountStrings<Key extends string>(amounts: Record<Key, Prisma.Decimal>) {
  return Object.fromEntries(Object.entries<Prisma.Decimal>(amounts).map(([key, value]) => [key, value.toFixed(2)])) as Record<Key, string>;
}

export function pagination({ page, pageSize }: PaginationQuery, total: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export function rentalJson(rental: ReportRental, now: Date) {
  const { id, reader, copy, status, issuedAt, dueAt, closedAt } = rental;
  return {
    id, reader, ...copy, status,
    issuedAt: issuedAt.toISOString(), dueAt: dueAt.toISOString(), closedAt: closedAt?.toISOString() ?? null,
    overdueMs: status === 'ACTIVE' && now > dueAt ? now.getTime() - dueAt.getTime() : null,
  };
}
