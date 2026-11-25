import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
import { PrismaBooksRepository } from '../src/modules/books/books.repository.js';
import { PrismaReadersRepository } from '../src/modules/readers/readers.repository.js';
import { PrismaBookCopiesRepository } from '../src/modules/book-copies/book-copies.repository.js';
import { AuditLogSubscriber, RentalEventPublisher } from '../src/modules/rentals/rental-events.js';
import { PrismaRentalsRepository } from '../src/modules/rentals/rentals.repository.js';
import type { RentalsService } from '../src/modules/rentals/rentals.service.js';
import type { ReturnPreviewInput } from '../src/modules/rentals/rentals.schemas.js';
import { databaseSnapshot } from './database-snapshot.js';
import { staffRequestHeaders } from '../test/helpers/auth.repository.js';

type Details = Awaited<ReturnType<RentalsService['details']>>;
type Preview = Awaited<ReturnType<RentalsService['preview']>>;
type List = Awaited<ReturnType<RentalsService['list']>>;

const origin = 'https://frontend.example.test';
const issueTime = '2026-11-01T10:00:00.000Z';
const dueAt = '2026-11-02T10:00:00.000Z';

async function fixture(db: PrismaClient) {
  const [standard, student] = await Promise.all([
    db.readerCategory.create({ data: { name: 'Стандартна', discountPercent: 0 } }),
    db.readerCategory.create({ data: { name: 'Студент', discountPercent: 10 } }),
  ]);
  const reader = await db.reader.create({ data: {
    fullName: 'Олена Тестова', phone: '+380000000000', address: 'Тестова адреса', categoryId: student.id,
  } });
  const book = await db.book.create({ data: {
    title: 'Історія Києва', author: 'Автор', genre: 'Історія', dailyPrice: '10.05', depositAmount: '30.05',
  } });
  const copies = await Promise.all(Array.from({ length: 8 }, (_, i) => db.bookCopy.create({ data: {
    bookId: book.id, inventoryCode: `RENTAL-${i}`,
  } })));
  const [minor, major, lost, none] = await Promise.all(['MINOR', 'MAJOR', 'LOST', 'NONE'].map(async (code) => {
    const seed = damageRules.find((rule) => rule.code === code);
    assert.ok(seed);
    return db.damageRule.create({ data: seed });
  }));
  const accounts = await Promise.all((['ADMIN', 'LIBRARIAN'] as const).map(async (role) => {
    const account = await db.staffUser.create({ data: { email: `${role.toLowerCase()}@integration.invalid`, role, passwordHash: 'fixture-not-a-login' } });
    const token = randomBytes(32).toString('base64url');
    await db.staffSession.create({ data: { staffUserId: account.id, tokenHash: sessionHash(token), expiresAt: new Date('2027-01-01Z') } });
    return { ...account, headers: staffRequestHeaders(origin, `library_session=${token}`) };
  }));
  return { standard, student, reader, book, copies, minor: minor!, major: major!, lost: lost!, none: none!, admin: accounts[0]!, librarian: accounts[1]! };
}

async function checkHttp(db: PrismaClient, sql: Client) {
  const { standard, student, reader, book, copies, minor, major, lost, none, admin, librarian } = await fixture(db);
  let now = new Date(issueTime);
  const events = new RentalEventPublisher();
  const seen: string[] = [];
  events.subscribe(new AuditLogSubscriber(db));
  events.subscribe({ async onRentalEvent(event) { seen.push(event.type); } });
  const server = createApp({ CORS_ORIGIN: origin }, {
    authRepository: new PrismaAuthRepository(db),
    booksRepository: new PrismaBooksRepository(db),
    readersRepository: new PrismaReadersRepository(db),
    bookCopiesRepository: new PrismaBookCopiesRepository({ db, transaction: (write) => db.$transaction(write) }),
    rentalsRepository: new PrismaRentalsRepository(db), rentalEvents: events, now: () => now,
  }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const request = (path: string, { body, headers = librarian.headers, method }: { body?: object; headers?: Record<string, string>; method?: string } = {}) =>
      fetch(api + path, { method: method ?? (body ? 'POST' : 'GET'), headers, ...(body && { body: JSON.stringify(body) }) });
    const expectData = async <T>(response: Response, status = 200): Promise<T> => {
      assert.equal(response.status, status, JSON.stringify(await response.clone().json()));
      return (await response.json() as { data: T }).data;
    };
    const expectError = async (response: Response, status: number, code?: string) => {
      assert.equal(response.status, status);
      if (code) assert.equal((await response.json() as { error: { code: string } }).error.code, code);
    };
    const payload = (index: number) => ({ copyId: copies[index]!.id, readerId: reader.id, dueAt });
    const issue = (index: number, headers = librarian.headers) => request('/rentals', { headers, body: payload(index) });
    const unchanged = { assessment: { type: 'UNCHANGED' } } as const;
    const loss = { assessment: { type: 'LOST' } } as const;
    const damage = (severity: 'MINOR' | 'MAJOR', condition: 'MINOR_DAMAGE' | 'MAJOR_DAMAGE', newDamageNotes = 'Новий надрив'): ReturnPreviewInput =>
      ({ assessment: { type: 'DAMAGED', severity, condition, newDamageNotes } });
    const preview = (id: string, input: ReturnPreviewInput) =>
      request(`/rentals/${id}/return-preview`, { headers: admin.headers, body: input });
    const close = (id: string, input: ReturnPreviewInput, previewVersion: string, headers = admin.headers) =>
      request(`/rentals/${id}/close`, { headers, body: { ...input, previewVersion } });
    const settle = async (id: string, input: ReturnPreviewInput, headers = admin.headers) => {
      const data = await expectData<Preview>(await preview(id, input));
      return close(id, input, data.previewVersion, headers);
    };
    const list = async (query: string) => {
      const response = await request(`/rentals?${query}`);
      assert.equal(response.status, 200);
      return await response.json() as List;
    };
    await expectError(await request('/rentals', { headers: {} }), 401, 'AUTH_REQUIRED');
    await expectError(await request('/damage-rules', { headers: {} }), 401);
    await expectError(await request('/rentals', { headers: { ...librarian.headers, Origin: 'https://wrong.example.test' }, body: payload(0) }), 403, 'CSRF_REJECTED');
    await expectError(await request(`/rentals/${randomUUID()}`), 404, 'RENTAL_NOT_FOUND');
    await expectError(await request('/rentals?status=INVALID'), 400, 'VALIDATION_ERROR');
    await expectError(await request('/rentals', { body: { ...payload(0), issuedById: admin.id } }), 400, 'VALIDATION_ERROR');
    await expectError(await request('/rentals', { body: { ...payload(0), dueAt: issueTime } }), 400, 'RENTAL_DUE_DATE_INVALID');
    await expectError(await request('/rentals', { body: { ...payload(0), dueAt: '2026-11-03T10:00' } }), 400, 'VALIDATION_ERROR');
    await expectError(await request('/rentals', { body: { ...payload(0), readerId: randomUUID() } }), 404, 'READER_NOT_FOUND');
    await expectError(await request('/rentals', { body: { ...payload(0), copyId: randomUUID() } }), 404, 'COPY_NOT_FOUND');
    await db.book.update({ where: { id: book.id }, data: { archivedAt: now } });
    await expectError(await issue(0), 409, 'BOOK_ARCHIVED');
    await db.book.update({ where: { id: book.id }, data: { archivedAt: null } });
    const beforeArchiveRace = await databaseSnapshot(db);
    const rollback = new Error('Intentional rollback of concurrent archive');
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.book.update({ where: { id: book.id }, data: { archivedAt: now } });
      await expectError(await issue(7), 409, 'RENTAL_WRITE_CONFLICT');
      throw rollback;
    }), (error) => error === rollback);
    assert.equal(await databaseSnapshot(db), beforeArchiveRace);

    const issueVersion = createHash('sha256').update(JSON.stringify([
      reader.id, copies[0]!.id, '10.05', '30.05', student.name, '10.00', 'GOOD', null,
    ])).digest('hex');
    const issueHeaders = { ...librarian.headers, 'X-Rental-Terms': issueVersion };
    const beforeTermsChange = await databaseSnapshot(db);
    await db.book.update({ where: { id: book.id }, data: { depositAmount: '31.00' } });
    await expectError(await issue(0, issueHeaders), 409, 'RENTAL_ISSUE_TERMS_CHANGED');
    await db.book.update({ where: { id: book.id }, data: { depositAmount: '30.05' } });
    assert.equal(await databaseSnapshot(db), beforeTermsChange);
    const issuedResponse = await issue(0, issueHeaders);
    const issued = await expectData<Details>(issuedResponse, 201);
    assert.equal(issuedResponse.headers.get('location'), `/api/rentals/${issued.id}`);
    assert.equal(issued.issuedAt, issueTime);
    assert.equal(issued.copy.status, 'RENTED');
    assert.equal(issued.issuedBy.id, librarian.id);
    assert.equal(issued.closedBy, null);
    assert.equal(issued.depositSnapshot, '30.05');
    assert.equal(issued.pricePerDaySnapshot, '10.05');
    assert.equal(issued.discountPercentSnapshot, '10.00');
    assert.equal(issued.readerCategorySnapshot, student.name);
    assert.deepEqual([issued.conditionAtIssue, issued.conditionNotesAtIssue, issued.conditionAtReturn], ['GOOD', null, null]);
    assert.deepEqual(issued.cashMovements.map(({ type, amount, recordedBy }) => [type, amount, recordedBy.id]), [['DEPOSIT_IN', '30.05', librarian.id]]);
    assert.deepEqual(Object.keys(issued.reader).sort(), ['fullName', 'id']);
    await expectError(await issue(0), 409, 'RENTAL_COPY_UNAVAILABLE');
    await assert.rejects(db.rental.create({ data: {
      ...payload(0), issuedById: admin.id, issuedAt: now, readerCategorySnapshot: student.name,
      pricePerDaySnapshot: '10.05', depositSnapshot: '30.05', discountPercentSnapshot: 10,
    } }), { code: 'P2002' });
    const catalog = await expectData<{ id: string; availableCopyCount: number }[]>(await request('/books?search=Києва'));
    assert.equal(catalog.find((item) => item.id === book.id)?.availableCopyCount, 7);
    const history = await expectData<{ id: string; status: string }[]>(await request(`/readers/${reader.id}/rentals`));
    assert.deepEqual(history.map(({ id, status }) => [id, status]), [[issued.id, 'ACTIVE']]);
    assert.equal((await list('overdue=true')).data.length, 0);
    now = new Date(dueAt);
    assert.equal((await list('overdue=true')).data.length, 0);
    now = new Date('2026-11-02T10:00:00.001Z');
    assert.equal((await list('status=ACTIVE&overdue=true&search=оЛЕНА')).data[0]?.id, issued.id);
    assert.equal((await list('overdue=false')).data.length, 0);
    assert.equal((await list('search=Києва')).data[0]?.id, issued.id);
    assert.equal((await list('search=rental-0')).data[0]?.id, issued.id);
    assert.equal((await list('search=%25')).data.length, 0);
    assert.equal((await list(`readerId=${reader.id}&bookId=${book.id}`)).pagination.total, 1);

    await db.book.update({ where: { id: book.id }, data: { dailyPrice: '20.00', depositAmount: '50.00', archivedAt: now } });
    await db.reader.update({ where: { id: reader.id }, data: { categoryId: standard.id } });
    const rules = await expectData<{ id: string; code: string; penaltyPercent: string; outcome: string }[]>(await request('/damage-rules'));
    assert.deepEqual(rules.map((rule) => [rule.code, rule.penaltyPercent, rule.outcome]), [
      ['NONE', '0.00', 'AVAILABLE'], ['MINOR', '10.00', 'AVAILABLE'], ['MAJOR', '50.00', 'MAINTENANCE'], ['LOST', '100.00', 'LOST'],
    ]);
    await db.damageRule.update({ where: { id: none.id }, data: { code: 'INACTIVE', penaltyPercent: 7 } });
    await expectError(await preview(issued.id, unchanged), 404, 'DAMAGE_RULE_NOT_FOUND');
    await db.damageRule.update({ where: { id: none.id }, data: { code: 'NONE' } });
    await expectError(await preview(issued.id, { ...unchanged, copyStatus: 'MAINTENANCE' }), 400, 'RENTAL_COPY_OUTCOME_INVALID');
    const beforePreview = await databaseSnapshot(db);
    now = new Date(dueAt);
    const oldQuote = await expectData<Preview>(await preview(issued.id, unchanged));
    assert.equal(oldQuote.billableDays, 1);
    now = new Date('2026-11-02T10:00:00.001Z');
    const quote = await expectData<Preview>(await preview(issued.id, unchanged));
    assert.deepEqual([quote.billableDays, quote.rentalFee, quote.damageFine, quote.deposit, quote.refundAmount, quote.additionalPayment], [2, '18.09', '0.00', '30.05', '11.96', '0.00']);
    assert.equal(await databaseSnapshot(db), beforePreview);
    await expectError(await request(`/rentals/${issued.id}/close`, { body: unchanged }), 400, 'VALIDATION_ERROR');
    await expectError(await close(issued.id, unchanged, oldQuote.previewVersion), 409, 'RENTAL_PREVIEW_CHANGED');
    const returned = await expectData<Details>(await close(issued.id, unchanged, quote.previewVersion));
    assert.equal(returned.status, 'RETURNED');
    assert.equal(returned.copy.status, 'AVAILABLE');
    assert.equal(returned.closedBy?.id, admin.id);
    assert.equal(returned.damagePercentSnapshot, '0.00');
    assert.equal(returned.refundAmount, '11.96');
    assert.equal(returned.cashMovements[1]?.type, 'REFUND_OUT');
    await expectError(await close(issued.id, unchanged, quote.previewVersion), 409, 'RENTAL_ALREADY_CLOSED');
    assert.equal((await list('status=RETURNED')).data[0]?.id, issued.id);
    assert.equal((await list('overdue=true')).data.length, 0);
    await db.book.update({ where: { id: book.id }, data: { archivedAt: null } });
    now = new Date(issueTime);

    const concurrentIssue = await Promise.all([issue(1, admin.headers), issue(1, librarian.headers)]);
    assert.deepEqual(concurrentIssue.map(({ status }) => status).sort(), [201, 409]);
    const minorRental = await expectData<Details>(concurrentIssue.find(({ status }) => status === 201)!, 201);
    assert.equal(await db.rental.count({ where: { copyId: copies[1]!.id, status: 'ACTIVE' } }), 1);
    assert.equal(await db.cashMovement.count({ where: { rentalId: minorRental.id } }), 1);
    const minorInput = damage('MINOR', 'MINOR_DAMAGE');
    const minorQuote = await expectData<Preview>(await preview(minorRental.id, minorInput));
    assert.equal(minorQuote.copyStatus, 'AVAILABLE');
    await db.damageRule.update({ where: { id: minor.id }, data: { penaltyPercent: '12.50' } });
    await expectError(await close(minorRental.id, minorInput, minorQuote.previewVersion), 409, 'RENTAL_PREVIEW_CHANGED');
    const minorMaintenance = { ...minorInput, copyStatus: 'MAINTENANCE' } as const;
    const override = await expectData<Preview>(await preview(minorRental.id, minorMaintenance));
    assert.deepEqual([override.copyStatus, override.damageFine, override.refundAmount], ['MAINTENANCE', '6.25', '23.75']);
    const concurrentClose = await Promise.all([
      close(minorRental.id, minorMaintenance, override.previewVersion, admin.headers),
      close(minorRental.id, minorMaintenance, override.previewVersion, librarian.headers),
    ]);
    assert.deepEqual(concurrentClose.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(await db.cashMovement.count({ where: { rentalId: minorRental.id, type: 'REFUND_OUT' } }), 1);
    assert.equal((await db.bookCopy.findUniqueOrThrow({ where: { id: copies[1]!.id } })).status, 'MAINTENANCE');
    assert.equal((await db.rental.findUniqueOrThrow({ where: { id: minorRental.id } })).damagePercentSnapshot?.toFixed(2), '12.50');

    const majorRental = await expectData<Details>(await issue(2, admin.headers), 201);
    const majorResult = await expectData<Details>(await settle(majorRental.id, damage('MAJOR', 'MAJOR_DAMAGE'), librarian.headers));
    assert.deepEqual([majorResult.copy.status, majorResult.damageFine, majorResult.refundAmount], ['MAINTENANCE', '25.00', '5.00']);
    assert.equal(majorResult.damageRuleId, major.id);
    const lostRental = await expectData<Details>(await issue(3), 201);
    const lostResult = await expectData<Details>(await settle(lostRental.id, loss));
    assert.deepEqual([lostResult.status, lostResult.copy.status, lostResult.copy.condition, lostResult.conditionAtReturn, lostResult.damageFine, lostResult.additionalPayment],
      ['LOST', 'LOST', 'LOST', 'LOST', '50.00', '20.00']);
    assert.deepEqual(lostResult.cashMovements.map(({ type, amount }) => [type, amount]).sort(), [['DEPOSIT_IN', '50.00'], ['TOPUP_IN', '20.00']]);
    assert.equal((await list('status=LOST')).data[0]?.id, lostRental.id);
    const paged = await list('page=2&pageSize=1');
    const full = await list('pageSize=10');
    assert.equal(paged.data[0]?.id, full.data[1]?.id);
    assert.equal(paged.pagination.total, full.data.length);
    assert.deepEqual(full.data.map(({ id }) => id), [...full.data].sort((a, b) => b.id.localeCompare(a.id)).map(({ id }) => id));

    // Force database-level insert failures after the service has already written rental and copy rows.
    const beforeFailedIssue = await databaseSnapshot(db);
    const beforeEvents = seen.length;
    await sql.query('ALTER TABLE "CashMovement" ADD CONSTRAINT "Test_Rejection" CHECK ("type" <> \'DEPOSIT_IN\') NOT VALID');
    await expectError(await issue(4), 500);
    assert.equal(await databaseSnapshot(db), beforeFailedIssue);
    assert.equal(seen.length, beforeEvents);
    await sql.query('ALTER TABLE "CashMovement" DROP CONSTRAINT "Test_Rejection"');
    const cashRental = await expectData<Details>(await issue(4), 201);
    const beforeFailedClose = await databaseSnapshot(db);
    await sql.query('ALTER TABLE "CashMovement" ADD CONSTRAINT "Test_Rejection" CHECK ("type" <> \'REFUND_OUT\') NOT VALID');
    await expectError(await settle(cashRental.id, damage('MINOR', 'MINOR_DAMAGE')), 500);
    assert.equal(await databaseSnapshot(db), beforeFailedClose);
    assert.equal(seen.length, beforeEvents + 1);
    await sql.query('ALTER TABLE "CashMovement" DROP CONSTRAINT "Test_Rejection"');

    const countBeforeAuditFailure = await db.auditLog.count();
    const audit = await db.auditLog.findMany({ where: { entityId: lostRental.id }, orderBy: { action: 'asc' } });
    assert.equal(audit.length, 2);
    assert.equal(audit[0]?.actorId, admin.id);
    assert.equal(audit[0]?.entityType, 'Rental');
    assert.deepEqual(audit[0]?.details, {
      status: 'LOST', copyStatus: 'LOST', damageRuleId: lost.id, ruleCode: 'LOST', damagePercent: '100.00',
      conditionAtIssue: 'GOOD', conditionAtReturn: 'LOST',
    });
    assert.equal(audit[1]?.details, null);
    await sql.query('ALTER TABLE "AuditLog" ADD CONSTRAINT "Test_Audit_Failure" CHECK (false) NOT VALID');
    const despiteAudit = await expectData<Details>(await settle(cashRental.id, unchanged));
    assert.equal(despiteAudit.status, 'RETURNED');
    assert.equal(await db.auditLog.count(), countBeforeAuditFailure);
    assert.equal(seen.length, beforeEvents + 2);
    assert.equal(await db.cashMovement.count({ where: { rentalId: cashRental.id } }), 2);
    await sql.query('ALTER TABLE "AuditLog" DROP CONSTRAINT "Test_Audit_Failure"');

    await db.book.update({ where: { id: book.id }, data: { dailyPrice: '20.00', depositAmount: '20.00' } });
    const exact = await expectData<Details>(await issue(5), 201);
    assert.equal((await expectData<Details>(await settle(exact.id, unchanged))).cashMovements.length, 1);
    await db.book.update({ where: { id: book.id }, data: { dailyPrice: '9999999999.99', depositAmount: '0.00' } });
    const noDeposit = await expectData<Details>(await issue(6), 201);
    assert.deepEqual(noDeposit.cashMovements.map(({ type, amount }) => [type, amount]), [['DEPOSIT_IN', '0.00']]);
    now = new Date('2026-11-03T10:00:00Z');
    await expectError(await preview(noDeposit.id, unchanged), 409, 'RENTAL_AMOUNT_OUT_OF_RANGE');
    await expectError(await close(noDeposit.id, unchanged, 'a'.repeat(64)), 409, 'RENTAL_AMOUNT_OUT_OF_RANGE');
    assert.equal((await expectData<Details>(await request(`/rentals/${noDeposit.id}`))).status, 'ACTIVE');

    now = new Date(issueTime);
    await db.book.update({ where: { id: book.id }, data: { dailyPrice: '20.00', depositAmount: '50.00' } });
    await db.damageRule.update({ where: { id: minor.id }, data: { penaltyPercent: 10, outcome: 'MAINTENANCE' } });
    const copyId = copies[7]!.id;
    const copyPath = `/books/${book.id}/copies/${copyId}`;
    const edit = (body: object, headers = admin.headers) => request(copyPath, { method: 'PATCH', body, headers });
    await db.bookCopy.update({ where: { id: copyId }, data: { condition: 'UNKNOWN' } });
    await expectError(await issue(7), 409, 'COPY_INSPECTION_REQUIRED');
    const issueInspected = (condition: string, conditionNotes: string) => request('/rentals', {
      body: { ...payload(7), inspection: { condition, conditionNotes } },
    });
    await expectError(await issueInspected('MAJOR_DAMAGE', 'Розірвана палітурка'), 409, 'COPY_CONDITION_STATUS_CONFLICT');
    const oldNote = 'Старий надрив обкладинки';
    const inspectedRental = await expectData<Details>(await issueInspected('MINOR_DAMAGE', oldNote), 201);
    assert.deepEqual([inspectedRental.conditionAtIssue, inspectedRental.conditionNotesAtIssue], ['MINOR_DAMAGE', oldNote]);
    await expectError(await edit({ condition: 'GOOD', conditionNotes: null }, librarian.headers), 403);
    await expectError(await edit({ condition: 'GOOD', conditionNotes: null }), 409, 'COPY_STATUS_CONFLICT');
    await expectError(await preview(inspectedRental.id, { assessment: { type: 'UNCHANGED', inspection: { condition: 'GOOD' } } }), 400, 'RENTAL_RETURN_INSPECTION_INVALID');
    const oldDamage = await expectData<Details>(await settle(inspectedRental.id, unchanged));
    assert.deepEqual([oldDamage.damagePercentSnapshot, oldDamage.damageFine, oldDamage.conditionAtReturn, oldDamage.newDamageNotes, oldDamage.copy.conditionNotes],
      ['0.00', '0.00', 'MINOR_DAMAGE', null, oldNote]);
    assert.equal(oldDamage.copy.status, 'AVAILABLE');
    await expectError(await issueInspected('GOOD', ''), 400, 'VALIDATION_ERROR');
    await expectError(await request('/rentals', { body: { ...payload(7), inspection: { condition: 'GOOD' } } }), 409, 'COPY_INSPECTION_CONFLICT');

    const next = await expectData<Details>(await issue(7), 201);
    await expectError(await preview(next.id, damage('MINOR', 'MINOR_DAMAGE', '  ')), 400, 'VALIDATION_ERROR');
    await expectError(await preview(next.id, damage('MAJOR', 'MINOR_DAMAGE')), 400, 'RENTAL_RETURN_CONDITION_INVALID');
    const minorSame = await expectData<Details>(await settle(next.id, damage('MINOR', 'MINOR_DAMAGE', 'Новий слід')));
    assert.deepEqual([minorSame.damagePercentSnapshot, minorSame.damageFine, minorSame.copy.status, minorSame.conditionNotesAtReturn, minorSame.newDamageNotes],
      ['10.00', '5.00', 'AVAILABLE', `${oldNote}\nНовий слід`, 'Новий слід']);
    const third = await expectData<Details>(await issue(7), 201);
    const cumulative = await expectData<Details>(await settle(third.id, damage('MINOR', 'MAJOR_DAMAGE', 'Додатковий надрив')));
    assert.deepEqual([cumulative.damagePercentSnapshot, cumulative.copy.status, cumulative.copy.condition, cumulative.conditionNotesAtReturn],
      ['10.00', 'MAINTENANCE', 'MAJOR_DAMAGE', `${oldNote}\nНовий слід\nДодатковий надрив`]);
    await expectError(await edit({ status: 'AVAILABLE' }), 409, 'COPY_CONDITION_STATUS_CONFLICT');
    await expectError(await edit({ condition: 'GOOD', status: 'AVAILABLE' }), 400, 'COPY_CONDITION_NOTES_INVALID');
    const repaired = await expectData<{ condition: string; conditionNotes: string | null; status: string }>(
      await edit({ condition: 'GOOD', conditionNotes: null, status: 'AVAILABLE' }));
    assert.deepEqual([repaired.condition, repaired.conditionNotes, repaired.status], ['GOOD', null, 'AVAILABLE']);
    const historical = await expectData<Details>(await request(`/rentals/${third.id}`));
    assert.deepEqual([historical.conditionAtIssue, historical.conditionNotesAtIssue, historical.conditionAtReturn, historical.conditionNotesAtReturn],
      ['MINOR_DAMAGE', minorSame.conditionNotesAtReturn, 'MAJOR_DAMAGE', cumulative.conditionNotesAtReturn]);
    const bookDetails = await expectData<{ copies: { id: string; lastClosedRentalId: string | null }[] }>(await request(`/books/${book.id}`));
    assert.ok(bookDetails.copies.find((copy) => copy.id === copyId)?.lastClosedRentalId);

    await expectData(await edit({ condition: 'MINOR_DAMAGE', conditionNotes: oldNote }));
    const preDamaged = await expectData<Details>(await issue(7), 201);
    const newMajor = await expectData<Details>(await settle(preDamaged.id, damage('MAJOR', 'MAJOR_DAMAGE')));
    assert.deepEqual([newMajor.damagePercentSnapshot, newMajor.damageFine], ['50.00', '25.00']);
    await expectData(await edit({ condition: 'MINOR_DAMAGE', conditionNotes: oldNote, status: 'AVAILABLE' }));
    await db.damageRule.update({ where: { id: minor.id }, data: { penaltyPercent: 0 } });
    const zeroRate = await expectData<Details>(await issue(7), 201);
    const zeroFine = await expectData<Details>(await settle(zeroRate.id, damage('MINOR', 'MINOR_DAMAGE')));
    assert.deepEqual([zeroFine.damageFine, zeroFine.damageRuleId, zeroFine.newDamageNotes], ['0.00', minor.id, 'Новий надрив']);
    assert.ok(!JSON.stringify(await db.auditLog.findMany()).includes(oldNote));

    const legacyCopy = await db.bookCopy.create({ data: { bookId: book.id, inventoryCode: 'LEGACY-RENTED', status: 'RENTED', condition: 'UNKNOWN' } });
    const legacy = await db.rental.create({ data: {
      readerId: reader.id, copyId: legacyCopy.id, issuedById: librarian.id, issuedAt: now, dueAt,
      pricePerDaySnapshot: '20.00', depositSnapshot: '50.00', discountPercentSnapshot: 0, readerCategorySnapshot: standard.name,
    } });
    await expectError(await preview(legacy.id, unchanged), 400, 'RENTAL_RETURN_INSPECTION_INVALID');
    const legacyResult = await expectData<Details>(await settle(legacy.id, {
      assessment: { type: 'UNCHANGED', inspection: { condition: 'MAJOR_DAMAGE', conditionNotes: 'Пошкодження невідомого походження' } },
    }));
    assert.deepEqual([legacyResult.conditionAtIssue, legacyResult.conditionAtReturn, legacyResult.newDamageNotes,
      legacyResult.damagePercentSnapshot, legacyResult.copy.status], [null, 'MAJOR_DAMAGE', null, '0.00', 'MAINTENANCE']);
    console.info('Rentals API passed against PostgreSQL: roles, snapshots, status and cash transitions, concurrent requests, failure rollback and best-effort audit.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  assertLocalSeedTarget();
  const connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString });
  const live = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: 'public' }) });
  const schema = `rentals_check_${randomUUID().replaceAll('-', '')}`;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }) });
  await sql.connect();
  let before: string | undefined;
  let created = false;
  try {
    const { rows: [identity] } = await sql.query('SELECT current_database() AS database, current_user AS username');
    assert.deepEqual(identity, { database: 'library_db', username: 'library_user' });
    before = await databaseSnapshot(live);
    await sql.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await sql.query(`SET search_path TO "${schema}"`);
    const migrations = new URL('../prisma/migrations/', import.meta.url);
    for (const entry of (await readdir(migrations, { withFileTypes: true })).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const migration = await readFile(new URL(`${entry.name}/migration.sql`, migrations), 'utf8');
      await sql.query(migration.replace('CREATE SCHEMA IF NOT EXISTS "public";', ''));
    }
    const [target] = await db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`;
    assert.equal(target?.schema, schema);
    await checkHttp(db, sql);
  } finally {
    await db.$disconnect();
    try {
      if (created) {
        await sql.query('ROLLBACK');
        await sql.query(`DROP SCHEMA "${schema}" CASCADE`);
        assert.equal((await sql.query('SELECT to_regnamespace($1) AS name', [schema])).rows[0]?.name, null);
      }
      if (before !== undefined) {
        assert.equal(await databaseSnapshot(live) === before, true, 'Operational table contents changed during the check');
        console.info('Temporary schema removed. Verified unchanged rows in all ten application tables in public.');
      }
    } finally {
      await live.$disconnect();
      await sql.end();
    }
  }
}

await main();
