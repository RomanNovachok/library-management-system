import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatReportMoney } from '../src/utils/money.ts';
import { calendarRange, selectedPeriod, utcRange } from '../src/utils/report-period.ts';

process.env.TZ = 'Europe/Kyiv';

test('inclusive local end dates are converted to exclusive UTC across DST', () => {
  assert.deepEqual(utcRange('2026-03-29', '2026-03-29'), {
    from: '2026-03-28T22:00:00.000Z', to: '2026-03-29T21:00:00.000Z',
  });
  assert.deepEqual(utcRange('2026-10-25', '2026-10-25'), {
    from: '2026-10-24T21:00:00.000Z', to: '2026-10-25T22:00:00.000Z',
  });
  assert.equal(utcRange('2026-02-29', '2026-03-01'), null);
  assert.equal(utcRange('2026-03-29', '2026-03-28'), null);
  assert.equal(utcRange('2026-04-01', ''), null);
});

test('period presets follow the local calendar and keep custom endpoints from the URL', () => {
  const now = new Date('2026-04-02T21:30:00.000Z');
  assert.deepEqual(calendarRange('today', now), { fromDate: '2026-04-03', toDate: '2026-04-03' });
  assert.deepEqual(calendarRange('last7', now), { fromDate: '2026-03-28', toDate: '2026-04-03' });
  assert.deepEqual(calendarRange('month', now), { fromDate: '2026-04-01', toDate: '2026-04-30' });
  const filters = new URLSearchParams('period=custom&fromDate=2026-03-15&toDate=2026-04-01');
  assert.deepEqual(selectedPeriod(filters, now).range, { from: '2026-03-14T22:00:00.000Z', to: '2026-04-01T21:00:00.000Z' });
});

test('financial UI renders signed aggregates without converting the decimal string to a number', () => {
  assert.equal(formatReportMoney('-310.20'), '-310,20\u00a0грн');
  assert.equal(formatReportMoney('123456789012345678901.23'), '123\u00a0456\u00a0789\u00a0012\u00a0345\u00a0678\u00a0901,23\u00a0грн');
  assert.throws(() => formatReportMoney('4.8'));
});
