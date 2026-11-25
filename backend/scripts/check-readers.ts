import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { assertLocalSeedTarget, SeedSafetyError } from '../prisma/seed-library.js';
import { createApp } from '../src/app.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { ApiError } from '../src/lib/api-error.js';
import { prisma } from '../src/lib/prisma.js';
import { databaseSnapshot } from './database-snapshot.js';
import { requestSession, staffRequestHeaders } from '../test/helpers/auth.repository.js';
import { PrismaReadersRepository } from '../src/modules/readers/readers.repository.js';

let stage = 'connection';

async function rolledBack<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const rollback = new Error('Intentional Readers verification rollback');
  let result!: T;
  try {
    await prisma.$transaction(async (tx) => { result = await operation(tx); throw rollback; }, { timeout: 30_000 });
  } catch (error) {
    if (error === rollback) return result;
    throw error;
  }
  throw new Error('Verification transaction unexpectedly committed');
}
const readerSchema = z.object({ id: z.uuid(), fullName: z.string(), address: z.string(), phone: z.string(), categoryId: z.uuid(), category: z.object({ id: z.uuid(), name: z.string(), discountPercent: z.string() }) });
const readReader = async (response: Response) => {
  assert.ok(response.ok, `Unexpected HTTP ${response.status}`);
  return z.object({ data: readerSchema }).parse(await response.json()).data;
};
const readPage = async (response: Response) => {
  assert.equal(response.status, 200);
  return z.object({ data: z.array(readerSchema), pagination: z.object({ total: z.number(), totalPages: z.number() }) }).parse(await response.json());
};

async function checkApi(tx: Prisma.TransactionClient) {
  stage = 'categories';
  const categories = await tx.readerCategory.findMany({ orderBy: { id: 'asc' } });
  assert.ok(categories.length >= 2, 'At least two existing categories are required; do not reset the seed');
  const first = categories[0]!;
  const second = categories[1]!;
  const auth = await requestSession('LIBRARIAN');
  const headers = staffRequestHeaders('https://frontend.example.test', auth.cookie);
  const server = createApp({ CORS_ORIGIN: 'https://frontend.example.test', NODE_ENV: 'development' }, { readersRepository: new PrismaReadersRepository(tx), authRepository: auth.repository }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const request = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const marker = `Reader-check-${randomUUID()}`;
    const input = { fullName: `${marker}-A`, address: 'Умовна тестова адреса 1', phone: '+380 (00) 000-00-01', categoryId: first.id };
    stage = 'HTTP create and list';
    const response = await request('/readers', 'POST', input);
    assert.equal(response.status, 201);
    const reader = await readReader(response);
    assert.equal(response.headers.get('location'), `/api/readers/${reader.id}`);
    const other = await readReader(await request('/readers', 'POST', { ...input, fullName: `${marker}-B`, categoryId: second.id }));
    assert.equal((await readReader(await request(`/readers/${reader.id}`))).phone, input.phone);
    assert.equal((await readPage(await request(`/readers?search=${marker.toLowerCase()}&pageSize=1&page=2`))).data[0]?.id, other.id);
    assert.equal((await readPage(await request(`/readers?search=${marker}&categoryId=${first.id}`))).pagination.total, 1);
    assert.ok((await readPage(await request('/readers?search=000-00-01'))).data.some((item) => item.id === reader.id));
    for (const literal of ['%', '_', '\\']) assert.equal((await readPage(await request(`/readers?search=${encodeURIComponent(literal)}&categoryId=${first.id}`))).data.some((item) => item.id === reader.id), false);
    const literalName = `${marker}-%_\\`;
    await readReader(await request(`/readers/${other.id}`, 'PATCH', { fullName: literalName }));
    assert.ok((await readPage(await request(`/readers?search=${encodeURIComponent('%_\\')}`))).data.some((item) => item.id === other.id));
    const empty = z.object({ data: z.array(z.unknown()), pagination: z.object({ total: z.number() }) }).parse(await (await request(`/readers/${reader.id}/rentals`)).json());
    assert.deepEqual(empty.data, []);

    // Synthetic fixtures exist only inside this transaction and can never become login accounts.
    stage = 'rollback rental fixtures';
    stage = 'rollback staff fixture';
    const staff = await tx.staffUser.create({ data: { email: `${randomUUID()}@integration.invalid`, passwordHash: 'test-fixture-not-a-login', isActive: false } });
    stage = 'rollback book fixture';
    const book = await tx.book.create({ data: { title: 'Умовна тестова книга', author: 'Тест', genre: 'Тест', dailyPrice: new Prisma.Decimal('1'), depositAmount: new Prisma.Decimal('10') } });
    for (const status of ['ACTIVE', 'RETURNED', 'LOST'] as const) {
      stage = `rollback ${status} copy fixture`;
      const copy = await tx.bookCopy.create({ data: { bookId: book.id, inventoryCode: `${marker}-${status}`, status: status === 'ACTIVE' ? 'RENTED' : status === 'LOST' ? 'LOST' : 'AVAILABLE' } });
      stage = `rollback ${status} rental fixture`;
      const rental = await tx.rental.create({ data: {
        readerId: reader.id, copyId: copy.id, issuedById: staff.id, status,
        issuedAt: new Date('2026-01-01T00:00:00Z'), dueAt: new Date('2026-01-02T00:00:00Z'),
        pricePerDaySnapshot: new Prisma.Decimal('1'), depositSnapshot: new Prisma.Decimal('10'),
        discountPercentSnapshot: first.discountPercent, readerCategorySnapshot: first.name,
        ...(status !== 'ACTIVE' && {
          closedAt: new Date('2026-01-02T00:00:00Z'), closedById: staff.id,
          rentalFee: new Prisma.Decimal('1'), damageFine: new Prisma.Decimal(status === 'LOST' ? '10' : '0'),
          damagePercentSnapshot: new Prisma.Decimal(status === 'LOST' ? '100' : '0'),
          refundAmount: new Prisma.Decimal(status === 'LOST' ? '0' : '9'), additionalPayment: new Prisma.Decimal(status === 'LOST' ? '1' : '0'),
        }),
      } });
      stage = `rollback ${status} cash fixture`;
      await tx.cashMovement.create({ data: { rentalId: rental.id, recordedById: staff.id, type: 'DEPOSIT_IN', amount: new Prisma.Decimal('10') } });
    }
    const historyBefore = JSON.stringify(await tx.rental.findMany({ orderBy: { id: 'asc' } }));
    stage = 'partial updates and history';
    const moneyBefore = JSON.stringify(await tx.cashMovement.findMany({ orderBy: { id: 'asc' } }));
    const copiesBefore = JSON.stringify(await tx.bookCopy.findMany({ orderBy: { id: 'asc' } }));
    const updated = await readReader(await request(`/readers/${reader.id}`, 'PATCH', { categoryId: second.id }));
    assert.equal(updated.category.discountPercent, second.discountPercent.toFixed(2));
    assert.equal(updated.address, input.address);
    const responses = await Promise.all([
      request(`/readers/${reader.id}`, 'PATCH', { address: 'Умовна оновлена адреса' }),
      request(`/readers/${reader.id}`, 'PATCH', { phone: '0000000002' }),
    ]);
    for (const result of responses) assert.equal(result.status, 200);
    const final = await readReader(await request(`/readers/${reader.id}`));
    assert.equal(final.address, 'Умовна оновлена адреса');
    assert.equal(final.phone, '0000000002');
    const rentalPage = z.object({ data: z.array(z.object({ id: z.uuid(), readerId: z.uuid(), status: z.string(), bookTitle: z.string(), inventoryCode: z.string(), issuedAt: z.string(), dueAt: z.string(), closedAt: z.string().nullable() })), pagination: z.object({ total: z.number(), totalPages: z.number() }) });
    const history = rentalPage.parse(await (await request(`/readers/${reader.id}/rentals?pageSize=2&page=2`)).json());
    assert.equal(history.data.length, 1);
    assert.equal(history.pagination.total, 3);
    assert.equal(history.pagination.totalPages, 2);
    assert.equal(history.data[0]?.bookTitle, book.title);
    assert.deepEqual(rentalPage.parse(await (await request(`/readers/${reader.id}/rentals?pageSize=2&page=2`)).json()), history);
    assert.equal(JSON.stringify(await tx.rental.findMany({ orderBy: { id: 'asc' } })), historyBefore);
    assert.equal(JSON.stringify(await tx.cashMovement.findMany({ orderBy: { id: 'asc' } })), moneyBefore);
    assert.equal(JSON.stringify(await tx.bookCopy.findMany({ orderBy: { id: 'asc' } })), copiesBefore);
    const categoryResponse = z.object({ data: z.array(z.object({ id: z.uuid(), discountPercent: z.string() })) }).parse(await (await request('/reader-categories')).json());
    assert.equal(categoryResponse.data.length, categories.length);
    assert.equal((await request(`/readers/${reader.id}`, 'PATCH', { categoryId: randomUUID() })).status, 400);
    assert.equal((await request(`/readers/${randomUUID()}`)).status, 404);
    assert.equal((await request(`/readers/${randomUUID()}/rentals`)).status, 404);

    // Force the FK race path directly; a savepoint prevents poisoning the outer rollback transaction.
    stage = 'FK conflict mapping';
    await tx.$executeRaw`SAVEPOINT reader_fk_check`;
    await assert.rejects(new PrismaReadersRepository(tx).update(reader.id, { categoryId: randomUUID() }), (error: unknown) => error instanceof ApiError && error.code === 'READER_CATEGORY_CONFLICT' && error.status === 409);
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT reader_fk_check`;
    await tx.$executeRaw`RELEASE SAVEPOINT reader_fk_check`;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

try {
  assertLocalSeedTarget();
  const [identity] = await prisma.$queryRaw<Array<{ database: string; username: string; schema: string }>>`SELECT current_database() AS database, current_user AS username, current_schema() AS schema`;
  assert.equal(identity?.database, 'library_db');
  assert.equal(identity.username, 'library_user');
  assert.equal(identity.schema, 'public');
  const original = await databaseSnapshot(prisma);
  try { await rolledBack(checkApi); }
  finally { assert.ok(await databaseSnapshot(prisma) === original, 'All ten tables must be unchanged after Readers verification, including failed checks'); }
  console.info('Readers integration passed: HTTP creation/details/search/filter/pages, literal SQL search, categories, overlapping partial PATCH, history and FK conflicts.');
  console.info('Rental snapshots, cash movements and copies preserved; all ten tables unchanged after rollback. No seed reset or record deletion.');
} catch (error) {
  console.error(error instanceof SeedSafetyError || error instanceof assert.AssertionError ? error.message : `Readers integration failed at ${stage}${error instanceof Prisma.PrismaClientKnownRequestError ? ` (${error.code})` : ''}. Personal and database details omitted.`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
