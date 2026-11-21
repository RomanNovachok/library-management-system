import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { assertLocalSeedTarget, SeedSafetyError } from '../prisma/seed-library.js';
import { createApp } from '../src/app.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { prisma } from '../src/lib/prisma.js';
import { PrismaBooksRepository } from '../src/modules/books/books.repository.js';

async function snapshot(db: Prisma.TransactionClient) {
  return JSON.stringify(await Promise.all([
    db.book.findMany({ orderBy: { id: 'asc' } }),
    db.bookCopy.findMany({ orderBy: { id: 'asc' } }),
    db.rental.findMany({ orderBy: { id: 'asc' } }),
    db.reader.findMany({ orderBy: { id: 'asc' } }),
    db.readerCategory.findMany({ orderBy: { id: 'asc' } }),
    db.damageRule.findMany({ orderBy: { id: 'asc' } }),
    db.cashMovement.findMany({ orderBy: { id: 'asc' } }),
    db.staffUser.findMany({ orderBy: { id: 'asc' } }),
    db.auditLog.findMany({ orderBy: { id: 'asc' } }),
  ]));
}

const bookResponse = z.object({ data: z.object({
  id: z.uuid(), title: z.string(), dailyPrice: z.string(), depositAmount: z.string(), archivedAt: z.string().nullable(),
}) });

try {
  // Reuse the established local-target guard without running or changing seed.
  assertLocalSeedTarget();
  const [identity] = await prisma.$queryRaw<Array<{ database: string; username: string; schema: string }>>`
    SELECT current_database() AS database, current_user AS username, current_schema() AS schema
  `;
  assert.equal(identity?.database, 'library_db', 'Unexpected database identity');
  assert.equal(identity.username, 'library_user', 'Unexpected database user');
  assert.equal(identity.schema, 'public', 'Unexpected database schema');

  const original = await snapshot(prisma);
  const rollback = new Error('Intentional rollback of books API verification');
  await assert.rejects(prisma.$transaction(async (tx) => {
    const app = createApp(
      { CORS_ORIGIN: 'https://frontend.example.com', NODE_ENV: 'development' },
      { booksRepository: new PrismaBooksRepository(tx) },
    );
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/books`;
      const request = (path = '', method = 'GET', body?: unknown) => fetch(`${base}${path}`, {
        method, headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const marker = `API-check-${randomUUID()}`;
      const created = await request('', 'POST', {
        title: `${marker}-A`, author: marker, genre: marker, dailyPrice: '12.50', depositAmount: '9999999999.99',
      });
      assert.equal(created.status, 201, 'Book creation must succeed');
      const { data: book } = bookResponse.parse(await created.json());
      assert.equal(book.dailyPrice, '12.50');
      assert.equal(book.depositAmount, '9999999999.99');
      const second = await request('', 'POST', { title: `${marker}-B`, author: marker, genre: marker, dailyPrice: '0', depositAmount: '0.10' });
      assert.equal(second.status, 201);
      await second.arrayBuffer();

      for (const filter of ['search', 'title', 'author', 'genre']) {
        const response = await request(`?${filter}=${marker.toLowerCase()}&page=2&pageSize=1`);
        assert.equal(response.status, 200);
        const catalog = z.object({
          data: z.array(z.object({ title: z.string(), copyCount: z.number(), availableCopyCount: z.number() })),
          pagination: z.object({ total: z.number(), totalPages: z.number() }),
        }).parse(await response.json());
        assert.equal(catalog.pagination.total, 2, 'Search must find both temporary books');
        assert.equal(catalog.pagination.totalPages, 2);
        assert.equal(catalog.data[0]?.title, `${marker}-B`);
        assert.equal(catalog.data[0]?.copyCount, 0);
      }
      for (const literal of ['%', '_', '\\']) {
        const response = await request(`?author=${marker}&title=${encodeURIComponent(literal)}`);
        const catalog = z.object({ data: z.array(z.unknown()) }).parse(await response.json());
        assert.equal(catalog.data.length, 0, 'SQL wildcard characters must be searched literally');
      }
      const edited = await request(`/${book.id}`, 'PATCH', { title: `${marker}-Edited%_\\Volume`, dailyPrice: '0.10' });
      assert.equal(edited.status, 200);
      assert.equal(bookResponse.parse(await edited.json()).data.dailyPrice, '0.10');
      const literalSearch = await request(`?author=${marker}&title=${encodeURIComponent('%_\\')}`);
      assert.equal(z.object({ data: z.array(z.unknown()) }).parse(await literalSearch.json()).data.length, 1);
      assert.equal((await tx.book.findUniqueOrThrow({ where: { id: book.id } })).depositAmount.toFixed(2), '9999999999.99');
      const archived = await request(`/${book.id}`, 'DELETE');
      assert.equal(archived.status, 204);
      const archiveDate = (await tx.book.findUniqueOrThrow({ where: { id: book.id } })).archivedAt;
      assert.ok(archiveDate);
      assert.equal((await request(`/${book.id}`, 'DELETE')).status, 409);
      assert.equal((await request(`/${book.id}`, 'PATCH', { title: marker })).status, 409);
      const catalogSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
      assert.equal(catalogSchema.parse(await (await request(`?search=${marker}`)).json()).data.length, 1);
      assert.equal(catalogSchema.parse(await (await request(`?search=${marker}&includeArchived=true`)).json()).data.length, 2);
      assert.equal(bookResponse.parse(await (await request(`/${book.id}`)).json()).data.archivedAt, archiveDate.toISOString());
      assert.equal((await request(`/${randomUUID()}`)).status, 404);

      // Archive one existing edition inside this rollback transaction, preserving every copy and rental.
      const existing = await tx.book.findFirst({ where: { id: { not: book.id }, author: { not: marker }, archivedAt: null } });
      if (existing) {
        const copies = await tx.bookCopy.findMany({ where: { bookId: existing.id }, orderBy: { id: 'asc' } });
        const history = await tx.rental.findMany({ orderBy: { id: 'asc' } });
        const details = z.object({ data: z.object({ copies: z.array(z.object({ id: z.string(), status: z.string() })) }) })
          .parse(await (await request(`/${existing.id}`)).json());
        assert.equal(details.data.copies.length, copies.length);
        const catalog = z.object({ data: z.array(z.object({ id: z.string(), copyCount: z.number(), availableCopyCount: z.number() })) })
          .parse(await (await request(`?title=${encodeURIComponent(existing.title)}&pageSize=100`)).json());
        const summary = catalog.data.find((item) => item.id === existing.id);
        assert.equal(summary?.copyCount, copies.length);
        assert.equal(summary?.availableCopyCount, copies.filter((copy) => copy.status === 'AVAILABLE').length);
        assert.equal((await request(`/${existing.id}`, 'DELETE')).status, 204);
        assert.deepEqual(await tx.bookCopy.findMany({ where: { bookId: existing.id }, orderBy: { id: 'asc' } }), copies);
        assert.deepEqual(await tx.rental.findMany({ orderBy: { id: 'asc' } }), history);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    throw rollback;
  }, { timeout: 30000 }), (error: unknown) => error === rollback);

  assert.equal(await snapshot(prisma), original, 'Rollback must preserve all existing rows across all nine tables');
  console.info('Books API integration passed: real PostgreSQL CRUD, Decimal, search, pagination, counts, 404/409 and archive rules.');
  console.info('All test writes rolled back; complete snapshots of all nine tables are unchanged.');
} catch (error) {
  console.error(error instanceof SeedSafetyError || error instanceof assert.AssertionError
    ? error.message
    : 'Books integration check failed. Check the local database and migrations; internal details omitted.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
