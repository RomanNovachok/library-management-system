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
import { PrismaBookCopiesRepository } from '../src/modules/book-copies/book-copies.repository.js';
import type { BookCopiesRepository } from '../src/modules/book-copies/book-copies.repository.js';


// Both successful and failed operations roll back, including concurrent contenders.
async function rolledBack<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const rollback = new Error('Intentional BookCopy verification rollback');
  let result!: T;
  try {
    await prisma.$transaction(async (tx) => { result = await operation(tx); throw rollback; }, { timeout: 30000 });
  } catch (error) {
    if (error === rollback) return result;
    throw error;
  }
  throw new Error('Verification transaction unexpectedly committed');
}

function transactionalRepository(tx: Prisma.TransactionClient) {
  return new PrismaBookCopiesRepository({
    db: tx,
    // SQL constraint errors abort a PostgreSQL transaction: isolate each HTTP mutation with a savepoint.
    transaction: async (operation) => {
      await tx.$executeRaw`SAVEPOINT book_copy_check`;
      try {
        const result = await operation(tx);
        await tx.$executeRaw`RELEASE SAVEPOINT book_copy_check`;
        return result;
      } catch (error) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT book_copy_check`;
        await tx.$executeRaw`RELEASE SAVEPOINT book_copy_check`;
        throw error;
      }
    },
  });
}

async function withHttp<T>(repository: BookCopiesRepository, operation: (base: string, headers: ReturnType<typeof staffRequestHeaders>) => Promise<T>) {
  const auth = await requestSession('ADMIN');
  const app = createApp({ CORS_ORIGIN: 'https://frontend.example.com', NODE_ENV: 'development' }, { bookCopiesRepository: repository, authRepository: auth.repository });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    return await operation(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/books`, staffRequestHeaders('https://frontend.example.com', auth.cookie));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const copyJson = z.object({ id: z.uuid(), bookId: z.uuid(), inventoryCode: z.string(), status: z.string() });
const readCopy = async (response: Response) => z.object({ data: copyJson }).parse(await response.json()).data;
const readList = async (response: Response) => z.object({ data: z.array(copyJson) }).parse(await response.json()).data;
async function expectConflict(response: Response, code: string) {
  assert.equal(response.status, 409, 'Conflicting copy operation must return 409');
  const error = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;
  assert.equal(error.code, code);
  assert.ok(!/Prisma|PostgreSQL|SELECT|constraint/i.test(error.message), 'Database internals must not reach the client');
}

async function rentalFixture(tx: Prisma.TransactionClient, copyId: string, closed = false) {
  const marker = randomUUID();
  const staff = await tx.staffUser.create({ data: { email: `${marker}@integration.invalid`, passwordHash: 'test-fixture-not-a-login', role: 'LIBRARIAN' } });
  const category = await tx.readerCategory.create({ data: { name: `rollback-${marker}` } });
  const reader = await tx.reader.create({ data: { fullName: 'Rollback fixture', address: 'Test', phone: 'Test', categoryId: category.id } });
  return tx.rental.create({ data: {
    copyId, readerId: reader.id, issuedById: staff.id,
    issuedAt: new Date('2026-01-01T00:00:00Z'), dueAt: new Date('2026-01-02T00:00:00Z'),
    pricePerDaySnapshot: new Prisma.Decimal('1'), depositSnapshot: new Prisma.Decimal('10'),
    discountPercentSnapshot: new Prisma.Decimal('0'), readerCategorySnapshot: category.name,
    ...(closed && {
      status: 'RETURNED', closedAt: new Date('2026-01-02T00:00:00Z'), closedById: staff.id,
      rentalFee: new Prisma.Decimal('1'), damageFine: new Prisma.Decimal('0'), damagePercentSnapshot: new Prisma.Decimal('0'),
      refundAmount: new Prisma.Decimal('9'), additionalPayment: new Prisma.Decimal('0'),
    }),
  } });
}

async function checkCrud(tx: Prisma.TransactionClient) {
  const book = await tx.book.create({ data: { title: `rollback-${randomUUID()}`, author: 'Test', genre: 'Test', dailyPrice: new Prisma.Decimal('1'), depositAmount: new Prisma.Decimal('10') } });
  const other = await tx.book.create({ data: { title: 'Other rollback book', author: 'Test', genre: 'Test', dailyPrice: new Prisma.Decimal('1'), depositAmount: new Prisma.Decimal('10') } });
  const marker = randomUUID();
  await withHttp(transactionalRepository(tx), async (base, headers) => {
    const request = (path = '', method = 'GET', body?: unknown, parent = book.id) => fetch(`${base}/${parent}/copies${path}`, {
      method, headers, ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    assert.deepEqual(await readList(await request()), []);
    const response = await request('', 'POST', { inventoryCode: `  ${marker}  ` });
    assert.equal(response.status, 201);
    const copy = await readCopy(response);
    assert.equal(copy.inventoryCode, marker);
    assert.equal(copy.status, 'AVAILABLE');
    assert.equal(response.headers.get('location'), `/api/books/${book.id}/copies/${copy.id}`);
    await expectConflict(await request('', 'POST', { inventoryCode: marker }, other.id), 'INVENTORY_CODE_EXISTS');
    const second = await readCopy(await request('', 'POST', { inventoryCode: `${marker}-second` }));
    await expectConflict(await request(`/${second.id}`, 'PATCH', { inventoryCode: marker, status: 'MAINTENANCE' }), 'INVENTORY_CODE_EXISTS');
    assert.equal((await tx.bookCopy.findUniqueOrThrow({ where: { id: second.id } })).status, 'AVAILABLE');

    for (const status of ['MAINTENANCE', 'AVAILABLE']) {
      const edited = await request(`/${copy.id}`, 'PATCH', { status, inventoryCode: `${marker}-${status}` });
      assert.equal(edited.status, 200);
      assert.equal((await readCopy(edited)).status, status);
      assert.deepEqual((await readList(await request(`?status=${status}`))).map((item) => item.status), status === 'AVAILABLE' ? ['AVAILABLE', 'AVAILABLE'] : ['MAINTENANCE']);
    }
    for (const status of ['RENTED', 'LOST']) {
      await expectConflict(await request(`/${copy.id}`, 'PATCH', { status }), 'COPY_STATUS_CONFLICT');
    }
    const foreign = await request(`/${copy.id}`, 'GET', undefined, other.id);
    assert.equal(foreign.status, 404);
    await foreign.arrayBuffer();
    const missing = await request('', 'GET', undefined, randomUUID());
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();

    const historyCopy = await tx.bookCopy.create({ data: { bookId: book.id, inventoryCode: `${marker}-history` } });
    await rentalFixture(tx, historyCopy.id, true);
    const activeCopy = await tx.bookCopy.create({ data: { bookId: book.id, inventoryCode: `${marker}-active` } });
    await rentalFixture(tx, activeCopy.id);
    const rentalsBefore = JSON.stringify(await tx.rental.findMany({ orderBy: { id: 'asc' } }));
    await expectConflict(await request(`/${historyCopy.id}`, 'DELETE'), 'COPY_HAS_RENTALS');
    await expectConflict(await request(`/${activeCopy.id}`, 'PATCH', { status: 'MAINTENANCE', inventoryCode: 'MUST-ROLLBACK' }), 'COPY_ACTIVE_RENTAL');
    await expectConflict(await request(`/${activeCopy.id}`, 'DELETE'), 'COPY_HAS_RENTALS');
    assert.equal((await request(`/${activeCopy.id}`, 'PATCH', { inventoryCode: `${marker}-renamed-active` })).status, 200);
    for (const status of ['RENTED', 'LOST', 'MAINTENANCE'] as const) {
      await tx.bookCopy.update({ where: { id: second.id }, data: { status } });
      await expectConflict(await request(`/${second.id}`, 'DELETE'), 'COPY_STATUS_CONFLICT');
      if (status !== 'MAINTENANCE') await expectConflict(await request(`/${second.id}`, 'PATCH', { status: 'AVAILABLE' }), 'COPY_STATUS_CONFLICT');
    }
    assert.equal(JSON.stringify(await tx.rental.findMany({ orderBy: { id: 'asc' } })), rentalsBefore, 'Copy CRUD must preserve every Rental field');

    assert.equal((await request(`/${copy.id}`, 'DELETE')).status, 204);
    assert.equal(await tx.bookCopy.findUnique({ where: { id: copy.id } }), null);
    const deleted = await request(`/${copy.id}`);
    assert.equal(deleted.status, 404);
    await deleted.arrayBuffer();
    await tx.book.update({ where: { id: book.id }, data: { archivedAt: new Date() } });
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      await expectConflict(await request(method === 'POST' ? '' : `/${second.id}`, method, method === 'DELETE' ? undefined : { inventoryCode: `${marker}-archived` }), 'BOOK_ARCHIVED');
    }
    assert.equal((await request(`/${second.id}`)).status, 200);
  });

  // Exercise real FK error mapping with a deliberately missing parent, within a savepoint.
  const repository = transactionalRepository(tx);
  await assert.rejects(repository.transaction((write) => write.create(randomUUID(), randomUUID())),
    (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'COPY_RELATION_CONFLICT');
}

async function checkConcurrency() {
  const existing = await prisma.bookCopy.findFirst({ where: { book: { archivedAt: null }, rentals: { none: { status: 'ACTIVE' } } } });
  assert.ok(existing, 'Concurrency checks require an existing copy of a non-archived book without an active rental; run the local seed first');
  // Even an unexpectedly successful contender is rolled back, so existing copies can never be deleted by this check.
  const contenderRepository = new PrismaBookCopiesRepository({ db: prisma, transaction: rolledBack });
  await withHttp(contenderRepository, async (base, headers) => {
    const mutate = (method: string, body?: unknown) => fetch(`${base}/${existing.bookId}/copies${method === 'POST' ? '' : `/${existing.id}`}`, {
      method, headers, ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    await rolledBack(async (holder) => {
      await holder.$queryRaw`SELECT "id" FROM "BookCopy" WHERE "id" = ${existing.id}::uuid FOR UPDATE`;
      await holder.bookCopy.update({ where: { id: existing.id }, data: { status: 'RENTED' } });
      for (const method of ['PATCH', 'DELETE']) {
        await expectConflict(await mutate(method, method === 'PATCH' ? { status: 'MAINTENANCE' } : undefined), 'COPY_WRITE_CONFLICT');
      }
    });
    await rolledBack(async (holder) => {
      await holder.book.update({ where: { id: existing.bookId }, data: { archivedAt: new Date() } });
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        await expectConflict(await mutate(method, method === 'DELETE' ? undefined : { inventoryCode: randomUUID() }), 'COPY_WRITE_CONFLICT');
      }
    });
    await rolledBack(async (holder) => {
      await rentalFixture(holder, existing.id);
      // The uncommitted Rental is invisible to reads, but its FK lock still protects the copy.
      await expectConflict(await mutate('DELETE'), 'COPY_WRITE_CONFLICT');
      await expectConflict(await mutate('PATCH', { status: 'MAINTENANCE' }), 'COPY_WRITE_CONFLICT');
    });
  });

  await rolledBack(async (holder) => {
    const repository = transactionalRepository(holder);
    await repository.transaction(async (write) => {
      await write.lockBook(existing.bookId);
      await write.lockCopy(existing.bookId, existing.id);
    });
    // A future Rental insertion and Books archival must also respect the locks held by copy CRUD.
    for (const operation of [
      (tx: Prisma.TransactionClient) => rentalFixture(tx, existing.id),
      (tx: Prisma.TransactionClient) => tx.book.update({ where: { id: existing.bookId }, data: { archivedAt: new Date() } }),
    ]) {
      await assert.rejects(rolledBack(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
        await operation(tx);
      }), (error: unknown) => {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
        const meta = error.meta as { driverAdapterError?: { cause?: { originalCode?: string } }; code?: string } | undefined;
        return meta?.code === '55P03' || meta?.driverAdapterError?.cause?.originalCode === '55P03';
      });
    }
  });
}

try {
  assertLocalSeedTarget();
  const [identity] = await prisma.$queryRaw<Array<{ database: string; username: string; schema: string }>>`
    SELECT current_database() AS database, current_user AS username, current_schema() AS schema
  `;
  assert.equal(identity?.database, 'library_db', 'Unexpected database identity');
  assert.equal(identity.username, 'library_user', 'Unexpected database user');
  assert.equal(identity.schema, 'public', 'Unexpected database schema');
  const original = await databaseSnapshot(prisma);
  await rolledBack(checkCrud);
  await checkConcurrency();
  assert.ok(await databaseSnapshot(prisma) === original, 'All ten tables must match their original snapshots after rollback');
  console.info('BookCopy integration passed: HTTP CRUD, filters, unique/FK errors, history preservation and real concurrent lock conflicts.');
  console.info('Concurrent Rental insertions and Book archival respect copy CRUD locks; all writes rolled back and all ten tables unchanged.');
} catch (error) {
  console.error(error instanceof SeedSafetyError || error instanceof assert.AssertionError
    ? error.message
    : 'BookCopy integration failed; check local PostgreSQL and migrations. Internal details omitted.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
