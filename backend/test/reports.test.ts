import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { BaseReport } from '../src/modules/reports/base-report.js';
import { createReportCreators } from '../src/modules/reports/report-creators.js';
import { amountStrings, cashTotals } from '../src/modules/reports/report-format.js';
import { FinancialReport, InventoryReport, RentalsReport } from '../src/modules/reports/report-generators.js';
import { reportPeriod } from '../src/modules/reports/report-period.js';
import { financialQuerySchema, inventoryQuerySchema, rentalsQuerySchema } from '../src/modules/reports/reports.schemas.js';
import { ReportService } from '../src/modules/reports/reports.service.js';
import { requestSession } from './helpers/auth.repository.js';
import { emptyReportsData, memoryReportsRepository } from './helpers/reports.repository.js';

test('BaseReport awaits fetchData and runs aggregate and format in a single template', async () => {
  const steps: string[] = [];
  class ExampleReport extends BaseReport<number, number[], number, string> {
    protected async fetchData(params: number) {
      steps.push('fetch:start');
      await Promise.resolve();
      steps.push('fetch:end');
      return [params, 1];
    }

    protected aggregate(data: number[]) {
      steps.push('aggregate');
      return data.reduce((sum, value) => sum + value, 0);
    }

    protected format(data: number) {
      steps.push('format');
      return String(data);
    }
  }
  assert.equal(await new ExampleReport().generate(4), '5');
  assert.deepEqual(steps, ['fetch:start', 'fetch:end', 'aggregate', 'format']);
});

test('ReportService dispatches through the concrete creators and the shared template', async (t) => {
  const repository = memoryReportsRepository();
  const creators = createReportCreators(repository);
  assert.ok(creators.inventory.createReport() instanceof InventoryReport);
  assert.ok(creators.rentals.createReport() instanceof RentalsReport);
  assert.ok(creators.financial.createReport() instanceof FinancialReport);

  const inventoryFactory = t.mock.method(creators.inventory, 'createReport');
  const rentalsFactory = t.mock.method(creators.rentals, 'createReport');
  const financialFactory = t.mock.method(creators.financial, 'createReport');
  const template = t.mock.method(BaseReport.prototype, 'generate');
  const clock = t.mock.fn(() => new Date('2026-03-31T22:00:00Z'));
  const service = new ReportService(repository, clock, creators);
  const inventory = await service.inventory(inventoryQuerySchema.parse({}));
  const rentals = await service.rentals(rentalsQuerySchema.parse({}));
  const financial = await service.financial(financialQuerySchema.parse({}));
  assert.deepEqual([inventory.type, rentals.type, financial.type], ['inventory', 'rentals', 'financial']);
  for (const factory of [inventoryFactory, rentalsFactory, financialFactory]) assert.equal(factory.mock.callCount(), 1);
  assert.equal(template.mock.callCount(), 3);
  assert.equal(clock.mock.callCount(), 3);
  assert.deepEqual(rentals.period, { from: '2026-03-31T21:00:00.000Z', to: '2026-04-30T21:00:00.000Z', timeZone: 'Europe/Kyiv' });
});

test('each GET uses its own report generator through the authenticated router', async (t) => {
  const { repository: authRepository, cookie } = await requestSession('LIBRARIAN');
  const data = { ...emptyReportsData };
  const inventory = t.mock.method(data, 'inventory');
  const rentals = t.mock.method(data, 'rentals');
  const financial = t.mock.method(data, 'financial');
  const dashboard = t.mock.method(data, 'dashboard');
  const template = t.mock.method(BaseReport.prototype, 'generate');
  const server = createApp({ CORS_ORIGIN: 'https://frontend.example.test' }, { authRepository, reportsRepository: memoryReportsRepository(data) }).listen(0, '127.0.0.1');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  for (const type of ['inventory', 'rentals', 'financial']) {
    const response = await fetch(`${base}/reports/${type}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { type: string }).type, type);
  }
  assert.deepEqual([inventory, rentals, financial, dashboard].map((method) => method.mock.callCount()), [1, 1, 1, 0]);
  assert.equal(template.mock.callCount(), 3);
});

test('report periods use local calendar month transitions and reject invalid boundaries', () => {
  const zone = 'America/New_York';
  const march = reportPeriod({ timeZone: zone }, new Date('2026-04-01T03:59:59.999Z'));
  assert.deepEqual([march.from.toISOString(), march.to.toISOString()], ['2026-03-01T05:00:00.000Z', '2026-04-01T04:00:00.000Z']);
  const april = reportPeriod({ timeZone: zone }, march.to);
  assert.equal(april.from.toISOString(), march.to.toISOString());
  const from = '2026-11-01T00:00:00+02:00';
  const to = '2026-11-02T00:00:00+02:00';
  assert.equal(financialQuerySchema.parse({ from, to }).from?.toISOString(), '2026-10-31T22:00:00.000Z');
  assert.equal(financialQuerySchema.parse({ from: '2026-11-01T00:00:00.12Z', to }).from?.toISOString(), '2026-11-01T00:00:00.120Z');
  for (const input of [{ from }, { to }, { from, to: from }, { from: to, to: from }, { from: '2026-02-30T00:00:00Z', to }]) {
    assert.equal(financialQuerySchema.safeParse(input).success, false);
  }
});

test('cash arithmetic preserves precision beyond an individual entry', () => {
  const deposit = new Prisma.Decimal('99999999999999999999999.99');
  const refund = new Prisma.Decimal('100000000000000000000000.02');
  assert.equal(amountStrings(cashTotals(deposit, refund, new Prisma.Decimal('0.01'))).netCash, '-0.02');
});
