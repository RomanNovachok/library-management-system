import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import type { Env } from '../src/config/env.js';
import { requestSession, staffRequestHeaders } from './helpers/auth.repository.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { ApiError } from '../src/lib/api-error.js';
import { PrismaBookCopiesRepository } from '../src/modules/book-copies/book-copies.repository.js';
import { BookCopiesService } from '../src/modules/book-copies/book-copies.service.js';
import { MemoryBookCopiesRepository, copiesBookId, copiesArchivedBookId, otherBookId, absentId } from './helpers/book-copies.repository.js';

const copyJson = z.strictObject({ id: z.uuid(), bookId: z.uuid(), inventoryCode: z.string(), status: z.enum(['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST']) });
const readCopy = async (response: Response) => z.object({ data: copyJson }).parse(await response.json()).data;
const readList = async (response: Response) => z.object({ data: z.array(copyJson) }).parse(await response.json()).data;
const readError = async (response: Response) => z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;

async function setup(t: TestContext, environment: Env['NODE_ENV'] = 'development', role: 'ADMIN' | 'LIBRARIAN' = 'ADMIN') {
  const repository = new MemoryBookCopiesRepository();
  const origin = 'https://frontend.example.com';
  const auth = await requestSession(role, environment === 'production');
  const headers = staffRequestHeaders(origin, auth.cookie);
  const app = createApp({ CORS_ORIGIN: origin, NODE_ENV: environment }, { bookCopiesRepository: repository, authRepository: auth.repository });
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
  await once(server, 'listening');
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/books`;
  const request = (path = '', method = 'GET', body?: unknown, bookId = copiesBookId) => fetch(`${root}/${bookId}/copies${path}`, {
    method, headers, ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { repository, request, root, headers };
}

test('copies list, all four status filters, empty book and archived book remain readable', async (t) => {
  const { repository, request } = await setup(t);
  const list = await request();
  assert.equal(list.status, 200);
  assert.equal((await readList(list)).length, 4);
  for (const status of ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST']) {
    const response = await request(`?status=${status}`);
    assert.equal(response.status, 200);
    assert.deepEqual((await readList(response)).map((copy) => copy.status), [status]);
  }
  assert.deepEqual(await readList(await request('', 'GET', undefined, otherBookId)), []);
  assert.deepEqual(await readList(await request('', 'GET', undefined, copiesArchivedBookId)), []);
  const copy = repository.copyWithStatus('AVAILABLE');
  assert.deepEqual(await readCopy(await request(`/${copy.id.toUpperCase()}`)), copy);
});

test('create trims inventory code, sets AVAILABLE and Location without changing existing data', async (t) => {
  const { repository, request } = await setup(t);
  const before = JSON.stringify([...repository.copies.values()]);
  const response = await request('', 'POST', { inventoryCode: '  NEW-001  ' });
  assert.equal(response.status, 201);
  const copy = await readCopy(response);
  assert.equal(response.headers.get('location'), `/api/books/${copiesBookId}/copies/${copy.id}`);
  assert.equal(copy.inventoryCode, 'NEW-001');
  assert.equal(copy.status, 'AVAILABLE');
  assert.equal(copy.bookId, copiesBookId);
  assert.equal(JSON.stringify([...repository.copies.values()].filter((item) => item.id !== copy.id)), before);
});

test('inventory-only edit works for all statuses, including active rentals, without changing status/history', async (t) => {
  const { repository, request } = await setup(t);
  const history = JSON.stringify([...repository.rentalHistory]);
  const active = JSON.stringify([...repository.activeRentals]);
  for (const status of ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST'] as const) {
    const copy = repository.copyWithStatus(status);
    const response = await request(`/${copy.id}`, 'PATCH', { inventoryCode: `RENAMED-${status}` });
    assert.equal(response.status, 200);
    assert.deepEqual(await readCopy(response), { ...copy, inventoryCode: `RENAMED-${status}` });
  }
  assert.equal(JSON.stringify([...repository.rentalHistory]), history);
  assert.equal(JSON.stringify([...repository.activeRentals]), active);
});

test('AVAILABLE and MAINTENANCE transitions are supported and same-status requests are idempotent', async (t) => {
  const { repository, request } = await setup(t);
  const copy = repository.copyWithStatus('AVAILABLE');
  for (const status of ['MAINTENANCE', 'AVAILABLE', 'AVAILABLE']) {
    const response = await request(`/${copy.id}`, 'PATCH', { status });
    assert.equal(response.status, 200);
    assert.equal((await readCopy(response)).status, status);
  }
});

test('manual RENTED/LOST targets and transitions from RENTED/LOST are conflicts; combined edits roll back', async (t) => {
  const { repository, request } = await setup(t);
  const before = JSON.stringify([...repository.copies]);
  for (const current of ['AVAILABLE', 'MAINTENANCE', 'RENTED', 'LOST'] as const) {
    const copy = repository.copyWithStatus(current);
    for (const status of ['AVAILABLE', 'MAINTENANCE', 'RENTED', 'LOST']) {
      if (['AVAILABLE', 'MAINTENANCE'].includes(current) && ['AVAILABLE', 'MAINTENANCE'].includes(status)) continue;
      const response = await request(`/${copy.id}`, 'PATCH', { status, inventoryCode: 'MUST-NOT-CHANGE' });
      assert.equal(response.status, 409);
      assert.equal((await readError(response)).code, 'COPY_STATUS_CONFLICT');
    }
  }
  assert.equal(JSON.stringify([...repository.copies]), before);
});

test('active Rental prevents status edit even for an inconsistent AVAILABLE copy', async (t) => {
  const { repository, request } = await setup(t);
  const copy = repository.copyWithStatus('AVAILABLE');
  repository.activeRentals.add(copy.id);
  const response = await request(`/${copy.id}`, 'PATCH', { status: 'MAINTENANCE' });
  assert.equal(response.status, 409);
  assert.equal((await readError(response)).code, 'COPY_ACTIVE_RENTAL');
  assert.equal(repository.copies.get(copy.id)?.status, 'AVAILABLE');
});

test('global duplicate inventory codes conflict on POST and PATCH and preserve previous fields', async (t) => {
  const { repository, request } = await setup(t);
  const available = repository.copyWithStatus('AVAILABLE');
  const maintenance = repository.copyWithStatus('MAINTENANCE');
  const before = JSON.stringify([...repository.copies]);
  for (const [path, method, body] of [
    ['', 'POST', { inventoryCode: available.inventoryCode }],
    [`/${maintenance.id}`, 'PATCH', { inventoryCode: available.inventoryCode, status: 'AVAILABLE' }],
  ] as const) {
    const response = await request(path, method, body);
    assert.equal(response.status, 409);
    assert.equal((await readError(response)).code, 'INVENTORY_CODE_EXISTS');
  }
  const otherBook = await request('', 'POST', { inventoryCode: available.inventoryCode }, otherBookId);
  assert.equal(otherBook.status, 409);
  await otherBook.arrayBuffer();
  assert.equal(JSON.stringify([...repository.copies]), before);
});

test('archived books reject create, update and delete while allowing copy details', async (t) => {
  const { repository, request } = await setup(t);
  const copy = repository.copyWithStatus('AVAILABLE');
  repository.copies.set(copy.id, { ...copy, bookId: copiesArchivedBookId });
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const response = await request(method === 'POST' ? '' : `/${copy.id}`, method, method === 'DELETE' ? undefined : { inventoryCode: 'ARCHIVE-EDIT' }, copiesArchivedBookId);
    assert.equal(response.status, 409);
    assert.equal((await readError(response)).code, 'BOOK_ARCHIVED');
  }
  assert.equal((await request(`/${copy.id}`, 'GET', undefined, copiesArchivedBookId)).status, 200);
  assert.equal(repository.copies.get(copy.id)?.inventoryCode, copy.inventoryCode);
});

test('missing book/copy and mismatched parent return 404 for reads and mutations', async (t) => {
  const { repository, request } = await setup(t);
  const copy = repository.copyWithStatus('AVAILABLE');
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const response = await request(method === 'POST' ? '' : `/${copy.id}`, method, ['POST', 'PATCH'].includes(method) ? { inventoryCode: 'MISSING' } : undefined, absentId);
    assert.equal(response.status, 404);
    assert.equal((await readError(response)).code, 'BOOK_NOT_FOUND');
  }
  const missingBookList = await request('', 'GET', undefined, absentId);
  assert.equal(missingBookList.status, 404);
  await missingBookList.arrayBuffer();
  for (const [parent, id] of [[copiesBookId, absentId], [otherBookId, copy.id]]) {
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const response = await request(`/${id}`, method, method === 'PATCH' ? { inventoryCode: 'MISSING' } : undefined, parent);
      assert.equal(response.status, 404);
      assert.equal((await readError(response)).code, 'COPY_NOT_FOUND');
    }
  }
});

test('delete removes only an AVAILABLE copy without rentals; repeated delete is 404', async (t) => {
  const { repository, request } = await setup(t);
  const copy = repository.copyWithStatus('AVAILABLE');
  const before = [...repository.copies.values()].filter((item) => item.id !== copy.id);
  const response = await request(`/${copy.id}`, 'DELETE');
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.deepEqual([...repository.copies.values()], before);
  const repeated = await request(`/${copy.id}`, 'DELETE');
  assert.equal(repeated.status, 404);
  await repeated.arrayBuffer();
});

test('delete rejects every unavailable status and AVAILABLE copies with any rental history', async (t) => {
  const { repository, request } = await setup(t);
  const before = JSON.stringify([...repository.copies]);
  for (const status of ['RENTED', 'MAINTENANCE', 'LOST'] as const) {
    const response = await request(`/${repository.copyWithStatus(status).id}`, 'DELETE');
    assert.equal(response.status, 409);
    assert.equal((await readError(response)).code, 'COPY_STATUS_CONFLICT');
  }
  const copy = repository.copyWithStatus('AVAILABLE');
  repository.rentalHistory.add(copy.id);
  const response = await request(`/${copy.id}`, 'DELETE');
  assert.equal(response.status, 409);
  assert.equal((await readError(response)).code, 'COPY_HAS_RENTALS');
  assert.equal(JSON.stringify([...repository.copies]), before);
});

test('invalid UUID, status filters and unknown/repeated query fields are rejected', async (t) => {
  const { request } = await setup(t);
  for (const path of ['/invalid', '?status=UNKNOWN', '?status=', '?status=AVAILABLE&status=LOST', '?other=x']) {
    const response = await request(path);
    assert.equal(response.status, 400);
    assert.equal((await readError(response)).code, 'VALIDATION_ERROR');
  }
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const response = await request(method === 'POST' ? '' : `/${absentId}`, method, ['POST', 'PATCH'].includes(method) ? { inventoryCode: 'INV' } : undefined, 'bad-id');
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
});

test('strict copy bodies reject empty values, reassignment, system fields, relations and invalid status', async (t) => {
  const { repository, request } = await setup(t);
  const copy = repository.copyWithStatus('AVAILABLE');
  const before = JSON.stringify([...repository.copies]);
  for (const method of ['POST', 'PATCH']) {
    for (const body of [{}, [], null, { inventoryCode: '' }, { inventoryCode: ' \n\t' }, { inventoryCode: 123 }, { inventoryCode: 'x'.repeat(101) }, { inventoryCode: 'INV\0X' },
      ...['id', 'bookId', 'book', 'rentals', 'unknown'].map((field) => ({ inventoryCode: 'TEST', [field]: absentId }))]) {
      const response = await request(method === 'POST' ? '' : `/${copy.id}`, method, body);
      assert.equal(response.status, 400);
      await response.arrayBuffer();
    }
  }
  for (const status of ['AVAILABLE', 'RENTED', 'LOST', 'MAINTENANCE']) {
    const response = await request('', 'POST', { inventoryCode: 'TEST', status });
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  const response = await request(`/${copy.id}`, 'PATCH', { status: 'UNKNOWN' });
  assert.equal(response.status, 400);
  await response.arrayBuffer();
  assert.equal(JSON.stringify([...repository.copies]), before);
});

test('malformed copy mutations return 400 for ADMIN and 403 for LIBRARIAN before JSON parsing', async (t) => {
  for (const role of ['ADMIN', 'LIBRARIAN'] as const) {
    const { root, headers } = await setup(t, 'production', role);
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await fetch(`${root}/${copiesBookId}/copies${method === 'POST' ? '' : `/${absentId}`}`, {
        method, headers: { ...headers, 'X-Forwarded-For': '127.0.0.1', 'X-Role': 'ADMIN' }, body: '{',
      });
      assert.equal(response.status, role === 'ADMIN' ? 400 : 403);
      assert.equal((await readError(response)).code, role === 'ADMIN' ? 'INVALID_JSON' : 'ROLE_FORBIDDEN');
    }
  }
});

test('librarian can view copies', async (t) => {
  const { request, repository } = await setup(t, 'test', 'LIBRARIAN');
  const copy = repository.copyWithStatus('AVAILABLE');
  assert.equal((await readList(await request())).some((row) => row.id === copy.id), true);
  assert.equal((await readCopy(await request(`/${copy.id}`))).id, copy.id);
});

test('simultaneous service mutations surface a conflict instead of overwriting a locked copy', async () => {
  const repository = new MemoryBookCopiesRepository();
  const service = new BookCopiesService(repository);
  const copy = repository.copyWithStatus('AVAILABLE');
  const results = await Promise.allSettled([
    service.update(copiesBookId, copy.id, { status: 'MAINTENANCE' }),
    service.delete(copiesBookId, copy.id),
  ]);
  assert.equal(results[0]?.status, 'fulfilled');
  const rejected = results[1];
  assert.equal(rejected?.status, 'rejected');
  if (rejected?.status === 'rejected') {
    assert.ok(rejected.reason instanceof ApiError);
    assert.equal(rejected.reason.status, 409);
  }
  assert.equal(repository.copies.get(copy.id)?.status, 'MAINTENANCE');
});

test('repository maps unique, FK, lock, deadlock and serialization errors to safe conflicts', async () => {
  for (const [code, meta, expected] of [
    ['P2002', {}, 'INVENTORY_CODE_EXISTS'], ['P2003', {}, 'COPY_RELATION_CONFLICT'],
    ['P2034', {}, 'COPY_WRITE_CONFLICT'], ['P2025', {}, 'COPY_WRITE_CONFLICT'],
    ...['55P03', '40001', '40P01'].map((code) => ['P2010', { code }, 'COPY_WRITE_CONFLICT'] as const),
    ['P2010', { driverAdapterError: { cause: { originalCode: '55P03' } } }, 'COPY_WRITE_CONFLICT'],
  ] as const) {
    const repository = new PrismaBookCopiesRepository({
      db: {} as Prisma.TransactionClient,
      transaction: async () => { throw new Prisma.PrismaClientKnownRequestError('private PostgreSQL details', { code, meta, clientVersion: '7.10.1' }); },
    });
    await assert.rejects(repository.transaction(async () => {}), (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === expected && !error.message.includes('private'));
  }
});

test('unexpected copy repository errors return JSON 500 with no internal details', async (t) => {
  const { repository, request } = await setup(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(repository, 'transaction', async () => { throw new Error('private PostgreSQL credentials'); });
  const response = await request('', 'POST', { inventoryCode: 'ERR' });
  assert.equal(response.status, 500);
  assert.deepEqual(await readError(response), { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
});

test('copy detail and mutations validate copy UUID and reject unsupported query parameters before repository access', async (t) => {
  const { repository, request } = await setup(t);
  const copy = repository.copyWithStatus('AVAILABLE');
  const transaction = t.mock.method(repository, 'transaction');
  const lookup = t.mock.method(repository, 'findBook');
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    for (const path of ['/bad-id', `/${copy.id}?status=AVAILABLE`]) {
      const response = await request(path, method, method === 'PATCH' ? { inventoryCode: 'INV' } : undefined);
      assert.equal(response.status, 400);
      assert.equal((await readError(response)).code, 'VALIDATION_ERROR');
    }
  }
  const response = await request('?bookId=ignored', 'POST', { inventoryCode: 'INV' });
  assert.equal(response.status, 400);
  await response.arrayBuffer();
  assert.equal(transaction.mock.callCount(), 0);
  assert.equal(lookup.mock.callCount(), 0);
});
