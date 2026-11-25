import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '../src/generated/prisma/client.js';
import { NoDiscountStrategy, PercentageDiscountStrategy } from '../src/modules/rentals/discount-strategy.js';
import { billableDays, RentalCalculator } from '../src/modules/rentals/rental-calculator.js';
import { RentalEventPublisher } from '../src/modules/rentals/rental-events.js';
import { conditionForIssue, conditionForReturn } from '../src/modules/rentals/rental-condition.js';
import { returnPreviewSchema } from '../src/modules/rentals/rentals.schemas.js';

const { Decimal } = Prisma;
const issueTime = new Date('2026-11-01T10:00:00Z');
const terms = { issuedAt: issueTime, pricePerDaySnapshot: new Decimal('10.05'), depositSnapshot: new Decimal('30.05') };

test('billable days use UTC elapsed time with a one-day minimum and exact 24-hour boundaries', () => {
  assert.equal(billableDays(issueTime, issueTime), 1);
  assert.equal(billableDays(issueTime, new Date('2026-11-01T11:00:00+01:00')), 1);
  assert.equal(billableDays(issueTime, new Date('2026-11-02T09:59:59.999Z')), 1);
  assert.equal(billableDays(issueTime, new Date('2026-11-02T10:00:00Z')), 1);
  assert.equal(billableDays(issueTime, new Date('2026-11-02T10:00:00.001Z')), 2);
  assert.equal(billableDays(issueTime, new Date('2026-11-04T10:00:00Z')), 3);
  assert.throws(() => billableDays(issueTime, new Date(0)), { code: 'RENTAL_CLOCK_CONFLICT' });
});

test('NoDiscountStrategy keeps the base fee and PercentageDiscountStrategy rounds each charge half up', () => {
  const noDiscount = new RentalCalculator(new NoDiscountStrategy()).calculate(terms, { penaltyPercent: new Decimal(0) }, issueTime);
  assert.equal(noDiscount.rentalFee.toFixed(2), '10.05');
  assert.equal(noDiscount.refundAmount.toFixed(2), '20.00');
  const percentage = new RentalCalculator(new PercentageDiscountStrategy(new Decimal(10)));
  const oneDay = percentage.calculate(terms, { penaltyPercent: new Decimal(10) }, issueTime);
  assert.equal(oneDay.rentalFee.toFixed(2), '9.05');
  assert.equal(oneDay.damageFine.toFixed(2), '3.01');
  assert.equal(oneDay.deposit.toFixed(2), '30.05');
  assert.equal(oneDay.charges.toFixed(2), '12.06');
  assert.equal(oneDay.refundAmount.toFixed(2), '17.99');
  const twoDaysLost = percentage.calculate(terms, { penaltyPercent: new Decimal(100) }, new Date('2026-11-02T12:00:00Z'));
  assert.equal(twoDaysLost.rentalFee.toFixed(2), '18.09');
  assert.equal(twoDaysLost.damageFine.toFixed(2), '30.05');
  assert.equal(twoDaysLost.refundAmount.toFixed(2), '0.00');
  assert.equal(twoDaysLost.additionalPayment.toFixed(2), '18.09');
  const freeRental = new RentalCalculator(new PercentageDiscountStrategy(new Decimal(100))).calculate(terms, { penaltyPercent: new Decimal(50) }, issueTime);
  assert.equal(freeRental.rentalFee.toFixed(2), '0.00');
  assert.equal(freeRental.damageFine.toFixed(2), '15.03');
});

test('settlement handles exact offsets, zero, and Decimal(12,2) bounds', () => {
  const calc = new RentalCalculator(new NoDiscountStrategy());
  const none = { penaltyPercent: new Decimal(0) };
  const even = calc.calculate({ ...terms, depositSnapshot: terms.pricePerDaySnapshot }, none, issueTime);
  assert.equal(even.refundAmount.toFixed(2), '0.00');
  assert.equal(even.additionalPayment.toFixed(2), '0.00');
  const limit = new Decimal('9999999999.99');
  const max = calc.calculate({ ...terms, pricePerDaySnapshot: limit, depositSnapshot: limit }, { penaltyPercent: new Decimal(100) }, issueTime);
  assert.equal(max.charges.toFixed(2), '19999999999.98');
  assert.equal(max.additionalPayment.toFixed(2), '9999999999.99');
  assert.throws(() => calc.calculate({ ...terms, pricePerDaySnapshot: limit }, none, new Date('2026-11-03Z')), { code: 'RENTAL_AMOUNT_OUT_OF_RANGE' });
  for (const invalid of ['-1.00', 'NaN', 'Infinity']) {
    assert.throws(() => calc.calculate({ ...terms, depositSnapshot: new Decimal(invalid) }, none, issueTime), { code: 'RENTAL_AMOUNT_OUT_OF_RANGE' });
  }
});

test('publisher notifies subscribed observers, isolates a failed handler, and supports unsubscribe', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const publisher = new RentalEventPublisher();
  const event = { type: 'RENTAL_ISSUED', rentalId: 'rental', actorId: 'worker', occurredAt: issueTime } as const;
  const healthy = t.mock.fn(async () => {});
  const unsubscribe = publisher.subscribe({ onRentalEvent: healthy });
  publisher.subscribe({ onRentalEvent: async () => { throw new Error('fixture failure'); } });
  await publisher.publish(event);
  assert.equal(healthy.mock.calls.length, 1);
  assert.equal(log.mock.calls.length, 1);
  unsubscribe();
  await publisher.publish(event);
  assert.equal(healthy.mock.calls.length, 1);
});

test('issue records one trustworthy inspection and refuses inventory awaiting repair', () => {
  const uninspected = { condition: 'UNKNOWN', conditionNotes: null } as const;
  assert.throws(() => conditionForIssue(uninspected, undefined), { code: 'COPY_INSPECTION_REQUIRED' });
  assert.throws(() => conditionForIssue(uninspected, { condition: 'MAJOR_DAMAGE', conditionNotes: 'Damage' }), { code: 'COPY_CONDITION_STATUS_CONFLICT' });
  const inspected = { condition: 'MINOR_DAMAGE', conditionNotes: 'Existing damage' } as const;
  assert.deepEqual(conditionForIssue(uninspected, inspected), inspected);
  assert.deepEqual(conditionForIssue(inspected, undefined), inspected);
  assert.throws(() => conditionForIssue(inspected, { condition: 'GOOD' }), { code: 'COPY_INSPECTION_CONFLICT' });
});

test('return preserves old damage independently of the new severity and final availability', () => {
  const before = { conditionAtIssue: 'MINOR_DAMAGE', conditionNotesAtIssue: 'Existing damage' } as const;
  const unchanged = conditionForReturn(before, { assessment: { type: 'UNCHANGED' }, copyStatus: 'MAINTENANCE' });
  assert.deepEqual(unchanged, { ruleCode: 'NONE', copyStatus: 'MAINTENANCE', condition: 'MINOR_DAMAGE', conditionNotes: 'Existing damage', newDamageNotes: null });
  const cumulative = conditionForReturn(before, { assessment: { type: 'DAMAGED', severity: 'MINOR', condition: 'MAJOR_DAMAGE', newDamageNotes: 'Another tear' } });
  assert.deepEqual(cumulative, { ruleCode: 'MINOR', copyStatus: 'MAINTENANCE', condition: 'MAJOR_DAMAGE', conditionNotes: 'Existing damage\nAnother tear', newDamageNotes: 'Another tear' });
  assert.throws(() => conditionForReturn(before, { assessment: { type: 'DAMAGED', severity: 'MAJOR', condition: 'MINOR_DAMAGE', newDamageNotes: 'Tear' } }),
    { code: 'RENTAL_RETURN_CONDITION_INVALID' });
  assert.equal(returnPreviewSchema.safeParse({ assessment: { type: 'DAMAGED', severity: 'MINOR', condition: 'MINOR_DAMAGE', newDamageNotes: '  ' } }).success, false);
});
