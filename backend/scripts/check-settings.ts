import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { damageRules } from '../prisma/seed-library.js';
import { createApp } from '../src/app.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import { sessionHash } from '../src/modules/auth/auth.service.js';
import { PrismaReadersRepository } from '../src/modules/readers/readers.repository.js';
import { AuditLogSubscriber, RentalEventPublisher } from '../src/modules/rentals/rental-events.js';
import { PrismaRentalsRepository, type RentalsWriteData } from '../src/modules/rentals/rentals.repository.js';
import type { ReturnPreviewInput } from '../src/modules/rentals/rentals.schemas.js';
import type { RentalsService } from '../src/modules/rentals/rentals.service.js';
import { PrismaReportsRepository } from '../src/modules/reports/reports.repository.js';
import type { ReportService } from '../src/modules/reports/reports.service.js';
import { PrismaSettingsRepository, type SettingsWriteData } from '../src/modules/settings/settings.repository.js';
import type { SettingsService } from '../src/modules/settings/settings.service.js';
import { staffRequestHeaders } from '../test/helpers/auth.repository.js';
import { validReaderInput } from '../test/helpers/readers.repository.js';
import { withIsolatedDatabase } from './isolated-database.js';

type Category = Awaited<ReturnType<SettingsService['createCategory']>>;
type Rule = Awaited<ReturnType<SettingsService['updateDamageRule']>>;
type Rental = Awaited<ReturnType<RentalsService['details']>>;
type Quote = Awaited<ReturnType<RentalsService['preview']>>;
type Reader = { id: string; category: Omit<Category, 'readerCount'> };
const origin = 'https://frontend.example.test';
const now = new Date('2026-11-26T10:00:00Z');
const unchanged = { assessment: { type: 'UNCHANGED' } } as const;
const minorDamage = {
  assessment: { type: 'DAMAGED', severity: 'MINOR', condition: 'MINOR_DAMAGE', newDamageNotes: 'Новий надрив' },
} as const;
const majorDamage = {
  assessment: { type: 'DAMAGED', severity: 'MAJOR', condition: 'MAJOR_DAMAGE', newDamageNotes: 'Розірвана палітурка' },
} as const;

function beforeCommit() {
  let enter!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release, pause: async () => {
    enter();
    await released;
  } };
}

await withIsolatedDatabase('settings', async (db, sql, schema) => {
  let settingsGate: ReturnType<typeof beforeCommit> | undefined;
  let rentalsGate: ReturnType<typeof beforeCommit> | undefined;
  const settings = new class extends PrismaSettingsRepository {
    override transaction<T>(operation: (data: SettingsWriteData) => Promise<T>) {
      const gate = settingsGate;
      return super.transaction(async (data) => {
        const result = await operation(data);
        await gate?.pause();
        return result;
      });
    }
  }(db);
  const rentals = new class extends PrismaRentalsRepository {
    override transaction<T>(operation: (data: RentalsWriteData) => Promise<T>) {
      const gate = rentalsGate;
      return super.transaction(async (data) => {
        const result = await operation(data);
        await gate?.pause();
        return result;
      });
    }
  }(db);

  async function waitForLock(queryPart: string) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const { rowCount } = await sql.query(`SELECT 1 FROM pg_stat_activity
        WHERE application_name = $1 AND wait_event_type = 'Lock' AND strpos(query, $2) > 0`, [schema, queryPart]);
      if (rowCount) return;
      await delay(25);
    }
    assert.fail(`Expected a PostgreSQL lock wait for ${queryPart}`);
  }

  const auth = new PrismaAuthRepository(db, (operation) => db.$transaction(operation, { isolationLevel: 'ReadCommitted' }));
  const sessions = new Map<string, { id: string; tokenHash: string; headers: Record<string, string> }>();
  for (const role of ['ADMIN', 'LIBRARIAN'] as const) {
    const account = await db.staffUser.create({ data: { email: `${role.toLowerCase()}@settings.invalid`, passwordHash: 'fixture', role } });
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sessionHash(token);
    await db.staffSession.create({ data: { staffUserId: account.id, tokenHash, expiresAt: new Date('2027-01-01Z') } });
    sessions.set(role, { id: account.id, tokenHash, headers: staffRequestHeaders(origin, `library_session=${token}`) });
  }
  const admin = sessions.get('ADMIN')!;
  await db.damageRule.createMany({ data: [...damageRules] });
  const events = new RentalEventPublisher();
  events.subscribe(new AuditLogSubscriber(db));
  const server = createApp({ CORS_ORIGIN: origin }, {
    settingsRepository: settings, rentalsRepository: rentals, rentalEvents: events, authRepository: auth,
    readersRepository: new PrismaReadersRepository(db), reportsRepository: new PrismaReportsRepository(db), now: () => now,
  }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    function request(path: string, method = 'GET', body?: object, role = 'ADMIN', headers?: Record<string, string>) {
      return fetch(base + path, {
        method, headers: headers ?? sessions.get(role)?.headers ?? staffRequestHeaders(origin),
        ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
      });
    }
    async function json<T>(response: Response, status = 200): Promise<T> {
      const body: unknown = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      return body as T;
    }
    async function data<T>(response: Response, status = 200): Promise<T> {
      return (await json<{ data: T }>(response, status)).data;
    }
    async function error(response: Response, status: number, code?: string) {
      const result = await json<{ error: { code: string } }>(response, status);
      if (code !== undefined) assert.equal(result.error.code, code);
    }

    const categoriesPath = '/settings/reader-categories';
    const rulesPath = '/settings/damage-rules';
    const rules = await data<Rule[]>(await request(rulesPath));
    const rulePath = (code: string) => `${rulesPath}/${rules.find((rule) => rule.code === code)!.id}`;
    const create = (name: string, discountPercent: string) => request(categoriesPath, 'POST', { name, discountPercent });
    const rate = (code: string, penaltyPercent: string) => request(rulePath(code), 'PATCH', { penaltyPercent });

    for (const [path, method, body] of [
      [categoriesPath, 'GET', undefined], [categoriesPath, 'POST', { name: 'Доступ', discountPercent: '1' }],
      [`${categoriesPath}/${randomUUID()}`, 'PATCH', { name: 'Доступ' }],
      [rulesPath, 'GET', undefined], [rulePath('MINOR'), 'PATCH', { penaltyPercent: '1' }],
    ] as const) {
      await error(await request(path, method, body, 'anonymous'), 401);
      await error(await request(path, method, body, 'LIBRARIAN'), 403);
    }
    const { ['X-Library-Request']: _csrf, ...withoutCsrf } = admin.headers;
    await error(await request(categoriesPath, 'POST', { name: 'Доступ', discountPercent: '1' }, 'ADMIN', withoutCsrf), 403, 'CSRF_REJECTED');
    for (const role of ['ADMIN', 'LIBRARIAN']) {
      assert.deepEqual(await data(await request('/reader-categories', 'GET', undefined, role)), []);
      assert.equal((await data<Rule[]>(await request('/damage-rules', 'GET', undefined, role))).length, 4);
    }

    const category = await data<Category>(await create('  Тестова\t  група  ', '25'), 201);
    const categoryPath = `${categoriesPath}/${category.id}`;
    assert.deepEqual(category, { id: category.id, name: 'Тестова група', discountPercent: '25.00', readerCount: 0 });
    assert.ok((await data<Category[]>(await request('/reader-categories', 'GET', undefined, 'LIBRARIAN'))).some((row) => row.id === category.id));
    const other = await data<Category>(await create('Навчальна %_', '0'), 201);
    assert.equal(other.discountPercent, '0.00');
    assert.equal((await data<Category>(await create('Навчальна abc', '100.0'), 201)).discountPercent, '100.00');
    assert.equal((await data<Category>(await request(`${categoriesPath}/${other.id}`, 'PATCH', { discountPercent: '12.34' }))).discountPercent, '12.34');
    const concurrentCreates = await Promise.all([create('Спільна   категорія', '5'), create('спільна категорія', '6')]);
    assert.deepEqual(concurrentCreates.map(({ status }) => status).sort(), [201, 409]);
    await error(concurrentCreates.find(({ status }) => status === 409)!, 409, 'READER_CATEGORY_NAME_EXISTS');

    const beforeRejected = await db.auditLog.count();
    for (const input of [
      { name: '' }, { name: ' \t\n ' }, { name: 'а'.repeat(101) }, { name: 'a\u0000b' }, { actorId: randomUUID() },
      ...['-1', '100.01', '12.341', '1e2', 'NaN', '', 25, null].map((discountPercent) => ({ discountPercent })),
    ]) await error(await request(categoriesPath, 'POST', { name: 'Не записувати', discountPercent: '12', ...input }), 400);
    await error(await request(categoryPath, 'PATCH', {}), 400);
    await error(await request(`${categoriesPath}/bad`, 'PATCH', { name: 'Не записувати' }), 400);
    await error(await request(`${categoriesPath}/${randomUUID()}`, 'PATCH', { name: 'Не записувати' }), 404, 'READER_CATEGORY_NOT_FOUND');
    await error(await request(categoryPath, 'PATCH', { name: 'НАВЧАЛЬНА %_' }), 409, 'READER_CATEGORY_NAME_EXISTS');
    await error(await create('тестова  група', '20'), 409, 'READER_CATEGORY_NAME_EXISTS');
    await error(await rate('NONE', '1'), 400, 'DAMAGE_RULE_RATE_FIXED');
    await error(await rate('LOST', '99.99'), 400, 'DAMAGE_RULE_RATE_FIXED');
    await error(await rate('MINOR', '5.759'), 400);
    await error(await request(rulePath('MINOR'), 'PATCH', { code: 'OTHER' }), 400);
    await error(await request(rulePath('MINOR'), 'PATCH', { outcome: 'LOST' }), 400);
    await error(await request(`${rulesPath}/${randomUUID()}`, 'PATCH', { label: 'Правило' }), 404, 'DAMAGE_RULE_NOT_FOUND');
    assert.equal(await db.auditLog.count(), beforeRejected);

    const reader = await data<Reader>(await request('/readers', 'POST', { ...validReaderInput, categoryId: category.id }, 'LIBRARIAN'), 201);
    assert.equal(reader.category.discountPercent, '25.00');
    const categoryList = await data<Category[]>(await request(categoriesPath));
    assert.equal(categoryList.find(({ id }) => id === category.id)?.readerCount, 1);
    assert.equal(categoryList.find(({ id }) => id === other.id)?.readerCount, 0);
    assert.equal((await data<Reader[]>(await request(`/readers?categoryId=${category.id}`, 'GET', undefined, 'LIBRARIAN')))[0]?.id, reader.id);

    const book = await db.book.create({ data: { title: 'Тест', author: 'Автор', genre: 'Жанр', dailyPrice: '20.00', depositAmount: '200.00' } });
    const copy = await db.bookCopy.create({ data: { bookId: book.id, inventoryCode: 'SETTINGS-CHECK' } });
    const spare = await db.bookCopy.create({ data: { bookId: book.id, inventoryCode: 'SETTINGS-SPARE' } });
    const issueInput = { readerId: reader.id, copyId: copy.id, dueAt: '2026-11-27T10:00:00Z' };
    const issue = () => request('/rentals', 'POST', issueInput, 'LIBRARIAN');
    const preview = async (id: string, input: ReturnPreviewInput) => data<Quote>(await request(`/rentals/${id}/return-preview`, 'POST', input, 'LIBRARIAN'));
    const close = (id: string, input: ReturnPreviewInput, previewVersion: string) => request(`/rentals/${id}/close`, 'POST', { ...input, previewVersion }, 'LIBRARIAN');
    const first = await data<Rental>(await issue(), 201);
    assert.deepEqual([first.discountPercentSnapshot, first.readerCategorySnapshot], ['25.00', 'Тестова група']);
    await data<Category>(await request(categoryPath, 'PATCH', { name: '  Оновлена   група  ' }));
    settingsGate = beforeCommit();
    const updatingDiscount = request(categoryPath, 'PATCH', { discountPercent: '30' });
    try {
      await Promise.race([settingsGate.ready, updatingDiscount.then((response) => assert.fail(`Category exited early with ${response.status}`))]);
      await error(await request('/rentals', 'POST', { ...issueInput, copyId: spare.id }, 'LIBRARIAN'), 409, 'RENTAL_WRITE_CONFLICT');
    } finally {
      settingsGate.release();
      settingsGate = undefined;
    }
    await data<Category>(await updatingDiscount);
    assert.equal(await db.rental.count({ where: { copyId: spare.id } }), 0);
    const profile = await data<Reader>(await request(`/readers/${reader.id}`, 'GET', undefined, 'LIBRARIAN'));
    assert.deepEqual([profile.category.name, profile.category.discountPercent], ['Оновлена група', '30.00']);
    const firstQuote = await preview(first.id, unchanged);
    const firstClosed = await data<Rental>(await close(first.id, unchanged, firstQuote.previewVersion));
    assert.deepEqual([firstClosed.rentalFee, firstClosed.damageFine, firstClosed.refundAmount, firstClosed.discountPercentSnapshot, firstClosed.readerCategorySnapshot],
      ['15.00', '0.00', '185.00', '25.00', 'Тестова група']);

    const termsVersion = createHash('sha256').update(JSON.stringify([
      reader.id, copy.id, '20.00', '200.00', category.name, '25.00', 'GOOD', null,
    ])).digest('hex');
    await error(await request('/rentals', 'POST', issueInput, 'LIBRARIAN', { ...sessions.get('LIBRARIAN')!.headers, 'X-Rental-Terms': termsVersion }),
      409, 'RENTAL_ISSUE_TERMS_CHANGED');
    const second = await data<Rental>(await issue(), 201);
    assert.deepEqual([second.discountPercentSnapshot, second.readerCategorySnapshot], ['30.00', 'Оновлена група']);
    const oldQuote = await preview(second.id, minorDamage);
    assert.deepEqual([oldQuote.damagePercent, oldQuote.damageFine], ['10.00', '20.00']);
    const updatedMinor = await data<Rule>(await request(rulePath('MINOR'), 'PATCH', { label: '  Нові   незначні пошкодження ', penaltyPercent: '15' }));
    assert.deepEqual([updatedMinor.label, updatedMinor.penaltyPercent, updatedMinor.outcome], ['Нові незначні пошкодження', '15.00', 'AVAILABLE']);
    assert.equal((await data<Rule[]>(await request('/damage-rules', 'GET', undefined, 'LIBRARIAN'))).find(({ code }) => code === 'MINOR')?.penaltyPercent, '15.00');
    await db.book.update({ where: { id: book.id }, data: { depositAmount: '400.00' } });
    await error(await close(second.id, minorDamage, oldQuote.previewVersion), 409, 'RENTAL_PREVIEW_CHANGED');
    assert.equal(await db.cashMovement.count({ where: { rentalId: second.id } }), 1);
    const updatedQuote = await preview(second.id, minorDamage);
    const secondClosed = await data<Rental>(await close(second.id, minorDamage, updatedQuote.previewVersion));
    assert.deepEqual([secondClosed.rentalFee, secondClosed.damageFine, secondClosed.damagePercentSnapshot, secondClosed.refundAmount],
      ['14.00', '30.00', '15.00', '156.00']);

    const finance = () => request('/reports/financial?timeZone=UTC', 'GET', undefined, 'LIBRARIAN').then((response) => json<Awaited<ReturnType<ReportService['financial']>>>(response));
    const dashboard = () => request('/dashboard?timeZone=UTC', 'GET', undefined, 'LIBRARIAN').then((response) => json<Awaited<ReturnType<ReportService['dashboard']>>>(response));
    const financialBefore = await finance();
    assert.deepEqual(financialBefore.summary.charges, { rentalFee: '29.00', damageFine: '30.00', totalCharges: '59.00' });
    assert.deepEqual([financialBefore.summary.cash.depositIn, financialBefore.summary.cash.refundOut, financialBefore.summary.cash.netCash], ['400.00', '341.00', '59.00']);
    const dashboardBefore = await dashboard();
    assert.deepEqual(dashboardBefore.financial, { ...financialBefore.summary.charges, outstandingDeposits: '0.00' });
    const oldRows = await db.rental.findMany({ orderBy: { id: 'asc' } });
    const oldCash = await db.cashMovement.findMany({ orderBy: { id: 'asc' } });
    assert.equal((await data<Rule>(await rate('MINOR', '21.75'))).penaltyPercent, '21.75');
    assert.equal((await data<Rule>(await request(rulePath('MAJOR'), 'PATCH', { label: 'Значні пошкодження', penaltyPercent: '0' }))).penaltyPercent, '0.00');
    for (const code of ['NONE', 'LOST']) {
      const updated = await data<Rule>(await request(rulePath(code), 'PATCH', { label: `Уточнена назва ${code}` }));
      assert.deepEqual([updated.code, updated.penaltyPercent, updated.outcome], [code, code === 'NONE' ? '0.00' : '100.00', code === 'NONE' ? 'AVAILABLE' : 'LOST']);
    }
    assert.deepEqual(await db.rental.findMany({ orderBy: { id: 'asc' } }), oldRows);
    assert.deepEqual(await db.cashMovement.findMany({ orderBy: { id: 'asc' } }), oldCash);
    assert.deepEqual(await finance(), financialBefore);
    assert.deepEqual(await dashboard(), dashboardBefore);
    await data<Rule>(await rate('MINOR', '15.00'));

    const third = await data<Rental>(await issue(), 201);
    const beforeThird = await preview(third.id, minorDamage);
    settingsGate = beforeCommit();
    const settingsFirst = rate('MINOR', '18');
    let waitingClose: Promise<Response>;
    try {
      await Promise.race([settingsGate.ready, settingsFirst.then((response) => assert.fail(`Settings exited early with ${response.status}`))]);
      waitingClose = close(third.id, minorDamage, beforeThird.previewVersion);
      await waitForLock('FOR SHARE');
    } finally {
      settingsGate.release();
      settingsGate = undefined;
    }
    await data<Rule>(await settingsFirst);
    await error(await waitingClose!, 409, 'RENTAL_PREVIEW_CHANGED');

    const fresh = await preview(third.id, minorDamage);
    rentalsGate = beforeCommit();
    const closeFirst = close(third.id, minorDamage, fresh.previewVersion);
    let waitingSettings: Promise<Response>;
    try {
      await Promise.race([rentalsGate.ready, closeFirst.then((response) => assert.fail(`Close exited early with ${response.status}`))]);
      waitingSettings = rate('MINOR', '22');
      await waitForLock('UPDATE');
    } finally {
      rentalsGate.release();
      rentalsGate = undefined;
    }
    const thirdClosed = await data<Rental>(await closeFirst);
    assert.deepEqual([thirdClosed.damagePercentSnapshot, thirdClosed.damageFine, thirdClosed.refundAmount], ['18.00', '72.00', '314.00']);
    assert.equal((await data<Rule>(await waitingSettings!)).penaltyPercent, '22.00');

    const fourth = await data<Rental>(await issue(), 201);
    const zero = await preview(fourth.id, majorDamage);
    const fourthClosed = await data<Rental>(await close(fourth.id, majorDamage, zero.previewVersion));
    assert.deepEqual([fourthClosed.damageFine, fourthClosed.damagePercentSnapshot, fourthClosed.newDamageNotes, fourthClosed.copy.status],
      ['0.00', '0.00', majorDamage.assessment.newDamageNotes, 'MAINTENANCE']);

    const categoryAudits = await db.auditLog.findMany({ where: { entityId: category.id }, orderBy: { action: 'asc' } });
    assert.deepEqual(categoryAudits.map(({ action, actorId, entityType, createdAt }) => ({ action, actorId, entityType, createdAt })),
      ['READER_CATEGORY_CREATED', 'READER_CATEGORY_UPDATED', 'READER_CATEGORY_UPDATED'].map((action) => ({ action, actorId: admin.id, entityType: 'ReaderCategory', createdAt: now })));
    assert.deepEqual(categoryAudits[0]?.details, { before: null, after: { name: category.name, discountPercent: '25.00' } });
    const discountAudit = categoryAudits.find(({ details }) => (details as { after: { discountPercent?: string } }).after.discountPercent === '30.00');
    assert.deepEqual(discountAudit?.details, { before: { discountPercent: '25.00' }, after: { discountPercent: '30.00' } });
    const renameAudit = categoryAudits.find(({ details }) => (details as { after: { name?: string } }).after.name === 'Оновлена група');
    assert.deepEqual(renameAudit?.details, { before: { name: category.name }, after: { name: 'Оновлена група' } });
    const { id: minorRuleId } = updatedMinor;
    const ruleAudits = await db.auditLog.findMany({ where: { entityId: minorRuleId } });
    assert.ok(ruleAudits.every((row) => row.actorId === admin.id && row.action === 'DAMAGE_RULE_UPDATED' && row.entityType === 'DamageRule'));
    assert.ok(ruleAudits.some(({ details }) => (details as { after: { penaltyPercent?: string } }).after.penaltyPercent === '15.00'));

    const beforeAuditFailure = await db.auditLog.count();
    await sql.query('ALTER TABLE "AuditLog" ADD CONSTRAINT "Reject_Settings_Audit" CHECK (false) NOT VALID');
    const saved = await data<Category>(await create('Успішно попри збій аудиту', '10'), 201);
    assert.ok(await db.readerCategory.findUnique({ where: { id: saved.id } }));
    assert.equal(await db.auditLog.count(), beforeAuditFailure);
    await sql.query('ALTER TABLE "AuditLog" DROP CONSTRAINT "Reject_Settings_Audit"');

    const signingOut = beforeCommit();
    const revoke = auth.transaction(async (tx) => {
      await tx.deleteSession(admin.tokenHash);
      await signingOut.pause();
    });
    let queuedWrite: Promise<Response>;
    try {
      await Promise.race([signingOut.ready, revoke]);
      queuedWrite = create('Запит відкликаної сесії', '10');
      await waitForLock('pg_advisory_xact_lock');
    } finally {
      signingOut.release();
    }
    await revoke;
    await error(await queuedWrite!, 401, 'AUTH_REQUIRED');
    assert.equal(await db.auditLog.count(), beforeAuditFailure);
    assert.equal(await db.readerCategory.count({ where: { name: 'Запит відкликаної сесії' } }), 0);
    console.info('Settings HTTP passed: roles, validation, concurrency, Reader picklists, issue/return snapshots, financial reports, Dashboard and audit.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
