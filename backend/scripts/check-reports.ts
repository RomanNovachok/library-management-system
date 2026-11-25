import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { assertLocalSeedTarget, damageRules } from '../prisma/seed-library.js';
import { createApp } from '../src/app.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import { sessionHash } from '../src/modules/auth/auth.service.js';
import { RentalEventPublisher } from '../src/modules/rentals/rental-events.js';
import { PrismaRentalsRepository } from '../src/modules/rentals/rentals.repository.js';
import type { ReturnPreviewInput } from '../src/modules/rentals/rentals.schemas.js';
import type { RentalsService } from '../src/modules/rentals/rentals.service.js';
import { PrismaReportsRepository } from '../src/modules/reports/reports.repository.js';
import { inventoryQuerySchema } from '../src/modules/reports/reports.schemas.js';
import type { ReportService } from '../src/modules/reports/reports.service.js';
import { staffRequestHeaders } from '../test/helpers/auth.repository.js';
import { databaseSnapshot } from './database-snapshot.js';

const origin = 'https://frontend.example.test';
const primaryFrom = '2026-11-01T00:00:00.000Z';
const primaryTo = '2026-11-02T00:00:00.000Z';
const primaryClose = '2026-11-01T12:00:00.000Z';
const period = (from: string, to: string, timeZone = 'UTC') => new URLSearchParams({ from, to, timeZone }).toString();
type Result<K extends keyof ReportService> = Awaited<ReturnType<ReportService[K]>>;
type Details = Awaited<ReturnType<RentalsService['details']>>;
type Preview = Awaited<ReturnType<RentalsService['preview']>>;

async function checkHttp(db: PrismaClient) {
  let now = new Date('2026-10-30T09:00:00.000Z');
  const sessions = new Map<string, Record<string, string>>();
  for (const role of ['ADMIN', 'LIBRARIAN'] as const) {
    const staff = await db.staffUser.create({ data: { email: `${role.toLowerCase()}@reports.invalid`, passwordHash: 'test-session', role } });
    const token = randomBytes(32).toString('base64url');
    await db.staffSession.create({ data: { tokenHash: sessionHash(token), staffUserId: staff.id, expiresAt: new Date('2027-01-01Z') } });
    sessions.set(role, staffRequestHeaders(origin, `library_session=${token}`));
  }

  const reportsRepository = new PrismaReportsRepository(db);
  const server = createApp({ CORS_ORIGIN: origin }, {
    reportsRepository, authRepository: new PrismaAuthRepository(db),
    rentalsRepository: new PrismaRentalsRepository(db), rentalEvents: new RentalEventPublisher(), now: () => now,
  }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const read = (path: string, role = 'LIBRARIAN') => fetch(base + path, { headers: sessions.get(role) ?? {} });
    const post = (path: string, body: object) => fetch(base + path, {
      method: 'POST', headers: sessions.get('LIBRARIAN')!, body: JSON.stringify(body),
    });
    const json = async <T>(response: Response, status = 200): Promise<T> => {
      const body: unknown = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      return body as T;
    };
    const inventory = (query = '') => read(`/reports/inventory?${query}`).then((response) => json<Result<'inventory'>>(response));
    const rentals = (query = '') => read(`/reports/rentals?${query}`).then((response) => json<Result<'rentals'>>(response));
    const finance = (query: string) => read(`/reports/financial?${query}`).then((response) => json<Result<'financial'>>(response));
    const dashboard = () => read('/dashboard?timeZone=UTC').then((response) => json<Result<'dashboard'>>(response));
    const issue = async (copyId: string, readerId: string, dueAt: string) =>
      (await json<{ data: Details }>(await post('/rentals', { copyId, readerId, dueAt }), 201)).data;
    const close = async (id: string, input: ReturnPreviewInput) => {
      const { data: { previewVersion } } = await json<{ data: Preview }>(await post(`/rentals/${id}/return-preview`, input));
      return (await json<{ data: Details }>(await post(`/rentals/${id}/close`, { ...input, previewVersion }))).data;
    };
    const primary = period(primaryFrom, primaryTo);

    for (const path of ['/reports/inventory', '/reports/rentals', '/reports/financial', '/dashboard']) {
      assert.equal((await read(path, 'anonymous')).status, 401);
      for (const role of sessions.keys()) {
        const response = await read(path, role);
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
    }
    for (const path of [
      '/reports/inventory?archived=true', '/reports/inventory?search=x&search=y', '/reports/rentals?dateBy=dueAt',
      '/reports/rentals?status=OVERDUE', '/reports/rentals?from=2026-02-30T00:00:00Z',
      `/reports/financial?from=${primaryTo}`, `/reports/financial?${period(primaryTo, primaryFrom)}`,
      '/reports/financial?cashPage=0', '/dashboard?from=2026-11-01', '/dashboard?timeZone=Fantasy/City',
    ]) assert.equal((await read(path)).status, 400, path);
    const empty = await dashboard();
    assert.ok(Object.values(empty.summary).every((count) => count === 0));
    assert.ok(Object.values(empty.financial).every((amount) => amount === '0.00'));
    assert.deepEqual([empty.latestIssues, empty.latestClosures, empty.overdue], [[], [], []]);
    const emptyFinancial = await finance(primary);
    assert.ok(Object.values(emptyFinancial.summary.cash).every((amount) => amount === '0.00'));
    assert.deepEqual([emptyFinancial.charges.data, emptyFinancial.cash.data, emptyFinancial.trend.data], [[], [], []]);

    const category = await db.readerCategory.create({ data: { name: 'Звичайна' } });
    const reader = await db.reader.create({ data: { fullName: 'Читач Фонд', address: 'Фікстура', phone: '+380000000000', categoryId: category.id } });
    await db.damageRule.createMany({ data: [...damageRules] });
    const bookData = { author: 'Автор Фонду', genre: 'Детектив', dailyPrice: '4.80', depositAmount: '350.00' };
    const main = await db.book.create({ data: { ...bookData, title: 'A 100% Фонд' } });
    const archive = await db.book.create({ data: { ...bookData, title: 'B Архів', genre: 'Історія', archivedAt: now } });
    const noCopies = await db.book.create({ data: { ...bookData, title: 'C Без примірників', genre: 'ДЕТЕКТИВ' } });
    const [old, damaged, lost, preDamaged] = await Promise.all(['OLD', 'DAMAGE', 'LOSS', 'OLD-DAMAGE'].map((inventoryCode) =>
      db.bookCopy.create({ data: {
        bookId: main.id, inventoryCode,
        ...(inventoryCode === 'OLD-DAMAGE' && { condition: 'MINOR_DAMAGE', conditionNotes: 'Попередній надрив' }),
      } })));
    await db.bookCopy.create({ data: { bookId: main.id, inventoryCode: 'MAINT', status: 'MAINTENANCE', condition: 'MAJOR_DAMAGE', conditionNotes: 'Ремонт' } });
    await db.bookCopy.create({ data: { bookId: archive.id, inventoryCode: 'UNKNOWN', condition: 'UNKNOWN' } });

    const oldRental = await issue(old!.id, reader.id, '2026-10-31T10:30:00.000Z');
    now = new Date(primaryFrom);
    const primaryRental = await issue(damaged!.id, reader.id, primaryClose);
    const active = await dashboard();
    assert.deepEqual(active.summary, { editions: 2, availableCopies: 2, readers: 1, maintenanceCopies: 1, overdueRentals: 1, activeRentals: 2 });
    assert.equal(active.latestIssues[0]?.id, primaryRental.id);
    assert.equal(active.overdue[0]?.id, oldRental.id);
    const beforeClose = await finance(primary);
    assert.deepEqual(beforeClose.summary.charges, { rentalFee: '0.00', damageFine: '0.00', totalCharges: '0.00' });
    assert.deepEqual(beforeClose.summary.outstanding, { activeRentals: 2, deposits: '700.00' });
    assert.equal(beforeClose.summary.cash.depositIn, '350.00');

    now = new Date(primaryClose);
    const boundary = await rentals(primary);
    assert.equal(boundary.summary.current.overdue, 1);
    assert.equal(boundary.data[0]?.overdueMs, null);
    const overdue = await rentals(`${period('2026-10-30T00:00:00Z', primaryTo)}&overdue=true`);
    assert.deepEqual(overdue.data.map(({ id, overdueMs }) => ({ id, overdueMs })), [{ id: oldRental.id, overdueMs: 91_800_000 }]);
    const returned = await close(primaryRental.id, {
      assessment: { type: 'DAMAGED', severity: 'MINOR', condition: 'MINOR_DAMAGE', newDamageNotes: 'Новий надрив' },
    });
    assert.equal(returned.status, 'RETURNED');
    const afterClose = await dashboard();
    assert.equal(afterClose.summary.activeRentals, 1);
    assert.equal(afterClose.summary.availableCopies, 3);
    assert.equal(afterClose.latestClosures[0]?.id, primaryRental.id);
    assert.deepEqual(afterClose.financial, { rentalFee: '4.80', damageFine: '35.00', totalCharges: '39.80', outstandingDeposits: '350.00' });

    await db.book.update({ where: { id: main.id }, data: { dailyPrice: '18.45', depositAmount: '420.00' } });
    await db.damageRule.update({ where: { code: 'MINOR' }, data: { penaltyPercent: '20.00' } });
    const historical = await finance(`${primary}&pageSize=1&cashPage=2`);
    assert.deepEqual(historical.summary, {
      charges: { rentalFee: '4.80', damageFine: '35.00', totalCharges: '39.80' },
      cash: { depositIn: '350.00', refundOut: '310.20', topupIn: '0.00', inflow: '350.00', outflow: '310.20', netCash: '39.80' },
      outstanding: { activeRentals: 1, deposits: '350.00' },
    });
    assert.deepEqual([historical.charges.pagination.page, historical.cash.pagination.page, historical.cash.pagination.total], [1, 2, 2]);
    assert.equal(historical.cash.data[0]?.type, 'DEPOSIT_IN');
    assert.equal(historical.charges.data[0]?.refund, '310.20');
    assert.deepEqual(historical.trend.data, [{ bucket: '2026-11-01', ...historical.summary.charges, ...historical.summary.cash }]);
    const chromeQuery = 'pageSize=20&chargesPage=1&cashPage=1&timeZone=Europe%2FKiev&from=2026-10-31T22%3A00%3A00.000Z&to=2026-11-30T22%3A00%3A00.000Z';
    const chromeMonth = await finance(chromeQuery);
    assert.deepEqual(chromeMonth.period, { from: '2026-10-31T22:00:00.000Z', to: '2026-11-30T22:00:00.000Z', timeZone: 'Europe/Kyiv' });
    assert.deepEqual(chromeMonth.summary, historical.summary);
    assert.deepEqual(chromeMonth.trend, historical.trend);
    assert.equal(chromeMonth.charges.pagination.total, 1);
    assert.equal(chromeMonth.cash.pagination.total, 2);
    assert.deepEqual((await finance(chromeQuery.replace('Europe%2FKiev', 'Europe%2FKyiv'))).trend, chromeMonth.trend);
    const onlyRefund = await finance(period(primaryClose, primaryTo));
    assert.equal(onlyRefund.summary.cash.netCash, '-310.20');
    const noClosingAtExclusiveEnd = await finance(period(primaryFrom, primaryClose));
    assert.equal(noClosingAtExclusiveEnd.summary.charges.totalCharges, '0.00');
    assert.equal(noClosingAtExclusiveEnd.summary.cash.refundOut, '0.00');

    await db.book.update({ where: { id: main.id }, data: { dailyPrice: '4.80', depositAmount: '350.00' } });
    now = new Date(primaryTo);
    const loss = await issue(lost!.id, reader.id, '2026-11-02T12:00:00.000Z');
    const unchanged = await issue(preDamaged!.id, reader.id, '2026-11-02T13:00:00.000Z');
    assert.deepEqual((await finance(primary)).summary.cash, historical.summary.cash);
    now = new Date('2026-11-03T00:00:00.000Z');
    assert.equal((await close(loss.id, { assessment: { type: 'LOST' } })).status, 'LOST');
    const unchangedClose = await close(unchanged.id, { assessment: { type: 'UNCHANGED' } });
    assert.deepEqual([unchangedClose.damageFine, unchangedClose.conditionAtReturn, unchangedClose.newDamageNotes], ['0.00', 'MINOR_DAMAGE', null]);
    const closures = period('2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z');
    const byClose = await rentals(`${closures}&dateBy=closedAt&pageSize=1&page=2`);
    assert.deepEqual(byClose.summary.events, { issued: 0, closed: 2 });
    assert.deepEqual(byClose.summary.current.byStatus, { ACTIVE: 1, RETURNED: 2, LOST: 1 });
    assert.equal(byClose.data.length, 1);
    assert.equal(byClose.pagination.total, 2);
    assert.notEqual(byClose.data[0]?.id, (await rentals(`${closures}&dateBy=closedAt&pageSize=1`)).data[0]?.id);
    assert.deepEqual((await rentals(`${closures}&dateBy=closedAt&status=LOST&search=LOSS`)).data.map(({ id }) => id), [loss.id]);
    assert.equal((await rentals(`${closures}&dateBy=issuedAt`)).pagination.total, 0);
    const later = await finance(closures);
    assert.deepEqual(later.summary.charges, { rentalFee: '9.60', damageFine: '350.00', totalCharges: '359.60' });
    assert.deepEqual(later.summary.cash, { depositIn: '0.00', refundOut: '345.20', topupIn: '4.80', inflow: '4.80', outflow: '345.20', netCash: '-340.40' });
    const chargesPage = await finance(`${closures}&chargesPage=2&pageSize=1`);
    assert.equal(chargesPage.charges.pagination.page, 2);
    assert.equal(chargesPage.cash.pagination.page, 1);
    assert.equal(chargesPage.charges.data[0]?.id, byClose.data[0]?.id);
    const localBuckets = await finance(period('2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z', 'America/New_York'));
    assert.equal(localBuckets.trend.interval, 'month');
    assert.equal(localBuckets.trend.data[0]?.rentalFee, '0.00');
    assert.equal(localBuckets.trend.data[0]?.depositIn, '700.00');

    const fund = await inventory('pageSize=1&page=3');
    assert.deepEqual(fund.summary, {
      editions: 3, archivedEditions: 1, copies: 6, availableForIssue: 2, availability: { AVAILABLE: 3, RENTED: 1, MAINTENANCE: 1, LOST: 1 },
      conditions: { GOOD: 1, MINOR_DAMAGE: 2, MAJOR_DAMAGE: 1, LOST: 1, UNKNOWN: 1 },
    });
    assert.equal(fund.data[0]?.id, noCopies.id);
    assert.equal(fund.data[0]?.copies, 0);
    assert.equal(fund.data[0]?.availableForIssue, 0);
    assert.deepEqual(new Set(fund.genres.map((genre) => genre.toLowerCase())), new Set(['детектив', 'історія']));
    assert.equal(fund.genres.length, 2);
    assert.equal((await dashboard()).summary.availableCopies, fund.summary.availableForIssue);
    assert.deepEqual((await inventory('pageSize=1')).summary, fund.summary);
    const onlyArchive = await inventory('archived=archived&genre=історія');
    assert.equal(onlyArchive.data[0]?.id, archive.id);
    assert.deepEqual([onlyArchive.summary.availability.AVAILABLE, onlyArchive.summary.availableForIssue], [1, 0]);
    assert.deepEqual([onlyArchive.data[0]?.availability.AVAILABLE, onlyArchive.data[0]?.availableForIssue], [1, 0]);
    assert.deepEqual(onlyArchive.genres, ['Історія']);
    const onlyActive = await inventory('archived=active&genre=ДЕТЕКТИВ&pageSize=1');
    assert.equal(onlyActive.pagination.total, 2);
    assert.equal(onlyActive.summary.availableForIssue, onlyActive.summary.availability.AVAILABLE);
    assert.deepEqual(onlyActive.genres.map((genre) => genre.toLowerCase()), ['детектив']);
    assert.deepEqual((await inventory('search=Історія&genre=ДЕТЕКТИВ')).genres, ['Історія']);
    assert.equal((await inventory('genre=%25')).pagination.total, 0);
    assert.deepEqual((await inventory('search=%25')).data.map(({ id }) => id), [main.id]);
    assert.equal((await inventory('search=Автор')).pagination.total, 3);
    assert.deepEqual((await inventory('search=Історія')).data.map(({ id }) => id), [archive.id]);
    assert.equal((await inventory('search=_%25')).pagination.total, 0);
    await db.book.update({ where: { id: noCopies.id }, data: { genre: 'Музика_%' } });
    assert.deepEqual((await inventory(new URLSearchParams({ genre: 'музика_%' }).toString())).data.map(({ id }) => id), [noCopies.id]);

    const bigBook = await db.book.create({ data: { ...bookData, title: 'Велика застава', depositAmount: '9999999999.99' } });
    for (const inventoryCode of ['BIG-1', 'BIG-2']) {
      const copy = await db.bookCopy.create({ data: { bookId: bigBook.id, inventoryCode } });
      await issue(copy.id, reader.id, '2026-11-05T00:00:00Z');
    }
    const large = await finance(closures);
    assert.equal(large.summary.cash.depositIn, '19999999999.98');
    assert.equal(large.summary.cash.netCash, '19999999659.58');
    assert.equal(large.summary.outstanding.deposits, '20000000349.98');
    const beforeReads = await databaseSnapshot(db);
    await Promise.all([inventory(), rentals(), dashboard(), finance(closures)]);
    assert.equal(await databaseSnapshot(db) === beforeReads, true, 'Reports must not change any tables');
    const query = inventoryQuerySchema.parse({ search: 'C Без примірників' });
    await reportsRepository.read(async (data) => {
      const first = await data.inventory(query);
      await db.book.update({ where: { id: noCopies.id }, data: { archivedAt: now } });
      assert.deepEqual(await data.inventory(query), first);
      assert.equal(first.archivedEditions, 0);
    });
    assert.equal((await inventory(new URLSearchParams({ search: 'C Без примірників' }).toString())).summary.archivedEditions, 1);
    console.info('Reports HTTP passed against PostgreSQL, including both roles, all four endpoints, financial snapshots, period boundaries, and Dashboard updates.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  assertLocalSeedTarget();
  const connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString });
  const schema = `reports_check_${randomUUID().replaceAll('-', '')}`;
  const live = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: 'public' }) });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }) });
  await sql.connect();
  let before: string | undefined;
  let created = false;
  try {
    const identity = await sql.query('SELECT current_database() AS database, current_user AS username');
    assert.deepEqual(identity.rows[0], { database: 'library_db', username: 'library_user' });
    before = await databaseSnapshot(live);
    await sql.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await sql.query(`SET search_path TO "${schema}"`);
    const migrations = new URL('../prisma/migrations/', import.meta.url);
    const entries = (await readdir(migrations, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const { name } of entries) {
      const migration = await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8');
      await sql.query(migration.replace('CREATE SCHEMA IF NOT EXISTS "public";', ''));
    }
    const target = await db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`;
    assert.equal(target[0]?.schema, schema);
    await checkHttp(db);
  } finally {
    await db.$disconnect();
    try {
      if (created) {
        await sql.query('ROLLBACK');
        await sql.query(`DROP SCHEMA "${schema}" CASCADE`);
        assert.equal((await sql.query('SELECT to_regnamespace($1) AS name', [schema])).rows[0]?.name, null);
      }
      if (before !== undefined) {
        assert.equal(await databaseSnapshot(live) === before, true, 'Operational table contents changed during reports check');
        console.info('Verified unchanged rows in all ten application tables in public.');
      }
    } finally {
      await live.$disconnect();
      await sql.end();
    }
  }
}

await main();
