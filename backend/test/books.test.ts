import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import type { Env } from '../src/config/env.js';
import { requestSession, staffRequestHeaders } from './helpers/auth.repository.js';
import { bookId, archivedBookId, missingBookId, MemoryBooksRepository, validBookInput } from './helpers/books.repository.js';

const bookJson = z.object({
  id: z.uuid(), title: z.string(), author: z.string(), genre: z.string(),
  dailyPrice: z.string().regex(/^\d+\.\d{2}$/), depositAmount: z.string().regex(/^\d+\.\d{2}$/),
  archivedAt: z.iso.datetime().nullable(),
  copies: z.array(z.object({ id: z.uuid(), bookId: z.uuid(), inventoryCode: z.string(), status: z.string() })).optional(),
});
async function readBook(response: Response) {
  return z.object({ data: bookJson }).parse(await response.json());
}
async function readCatalog(response: Response) {
  return z.object({
    data: z.array(bookJson.extend({ copyCount: z.number().int(), availableCopyCount: z.number().int() })),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
  }).parse(await response.json());
}
async function readError(response: Response) {
  return z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json());
}

async function setup(t: TestContext, environment: Env['NODE_ENV'] = 'development', role: 'ADMIN' | 'LIBRARIAN' = 'ADMIN') {
  const repository = new MemoryBooksRepository();
  const origin = 'https://frontend.example.com';
  const auth = await requestSession(role, environment === 'production');
  const app = createApp({ CORS_ORIGIN: origin, NODE_ENV: environment }, { booksRepository: repository, authRepository: auth.repository });
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/books`;
  const request = (path = '', method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method,
    headers: { ...staffRequestHeaders(origin, auth.cookie), ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { repository, request, headers: staffRequestHeaders(origin, auth.cookie) };
}

test('catalog excludes archived books and returns copy counts, decimal strings and pagination', async (t) => {
  const { request } = await setup(t);
  const response = await request();
  assert.equal(response.status, 200);
  const json = await readCatalog(response);
  assert.deepEqual(json.pagination, { page: 1, pageSize: 20, total: 1, totalPages: 1 });
  assert.equal(json.data[0]!.id, bookId);
  assert.equal(json.data[0]!.dailyPrice, '4.50');
  assert.equal(json.data[0]!.depositAmount, '250.00');
  assert.equal(json.data[0]!.copyCount, 4);
  assert.equal(json.data[0]!.availableCopyCount, 1);
  assert.equal(json.data[0]!.copies, undefined);
});

test('search finds partial titles, authors and genres without case sensitivity; filters combine with AND', async (t) => {
  const { request } = await setup(t);
  for (const query of ['search=ALP', 'search=LES', 'search=dram', 'title=alp&author=LES&genre=drama']) {
    const response = await request(`?${query}`);
    assert.equal(response.status, 200);
    assert.deepEqual((await readCatalog(response)).data.map((book) => book.id), [bookId]);
  }
  const empty = await (await request('?title=alpha&author=unknown')).json();
  assert.deepEqual(empty, { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
});

test('explicit archive inclusion and stable pages; past the last page is empty', async (t) => {
  const { request } = await setup(t);
  const first = await readCatalog(await request('?includeArchived=true&pageSize=1'));
  const second = await readCatalog(await request('?includeArchived=true&pageSize=1&page=2'));
  assert.equal(first.data[0]!.id, bookId);
  assert.equal(second.data[0]!.id, archivedBookId);
  assert.deepEqual(second.pagination, { page: 2, pageSize: 1, total: 2, totalPages: 2 });
  assert.deepEqual((await readCatalog(await request('?page=99'))).data, []);
});

test('book details include every physical copy status; archived details remain readable', async (t) => {
  const { request } = await setup(t);
  const response = await request(`/${bookId.toUpperCase()}`);
  assert.equal(response.status, 200);
  const { data } = await readBook(response);
  assert.deepEqual(data.copies!.map((copy) => copy.status), ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST']);
  const archived = await request(`/${archivedBookId}`);
  assert.equal(archived.status, 200);
  assert.equal((await readBook(archived)).data.archivedAt, '2026-01-01T00:00:00.000Z');
});

test('create returns 201, Location and exact money; partial edit preserves unspecified fields', async (t) => {
  const { repository, request } = await setup(t);
  const existing = JSON.stringify([...repository.books.values()]);
  const response = await request('', 'POST', { ...validBookInput, title: '  New Book  ', dailyPrice: '0', depositAmount: '9999999999.99' });
  assert.equal(response.status, 201);
  const { data } = await readBook(response);
  assert.equal(response.headers.get('location'), `/api/books/${data.id}`);
  assert.equal(data.title, 'New Book');
  assert.equal(data.dailyPrice, '0.00');
  assert.equal(data.depositAmount, '9999999999.99');
  assert.equal(data.archivedAt, null);
  const edited = await request(`/${data.id}`, 'PATCH', { title: 'Updated', author: 'Updated Author', genre: 'Essay', dailyPrice: '0.10' });
  assert.equal(edited.status, 200);
  const book = (await readBook(edited)).data;
  assert.equal(book.title, 'Updated');
  assert.equal(book.author, 'Updated Author');
  assert.equal(book.genre, 'Essay');
  assert.equal(book.dailyPrice, '0.10');
  assert.equal(book.depositAmount, '9999999999.99');
  const depositEdit = await request(`/${data.id}`, 'PATCH', { depositAmount: '0' });
  assert.equal((await readBook(depositEdit)).data.depositAmount, '0.00');
  assert.equal(JSON.stringify([...repository.books.values()].filter((book) => book.id !== data.id)), existing);
  assert.equal((await readBook(await request(`/${data.id}`))).data.copies!.length, 0);
});

test('soft delete preserves book, copy links and rental history; repeat and edits return 409', async (t) => {
  const { repository, request } = await setup(t);
  const copies = JSON.stringify(repository.copies);
  const history = JSON.stringify(repository.rentalHistory);
  const untouchedBook = JSON.stringify(repository.books.get(archivedBookId));
  const response = await request(`/${bookId}`, 'DELETE');
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  const archivedAt = repository.books.get(bookId)!.archivedAt;
  assert.ok(archivedAt instanceof Date);
  assert.equal(repository.books.size, 2);
  assert.equal((await readCatalog(await request())).data.length, 0);
  assert.equal((await readCatalog(await request('?includeArchived=true'))).data.length, 2);
  for (const method of ['DELETE', 'PATCH']) {
    const conflict = await request(`/${bookId}`, method, method === 'PATCH' ? { title: 'Forbidden' } : undefined);
    assert.equal(conflict.status, 409);
    assert.equal((await readError(conflict)).error.code, 'BOOK_ARCHIVED');
  }
  assert.equal(repository.books.get(bookId)!.archivedAt, archivedAt);
  assert.equal(JSON.stringify(repository.copies), copies);
  assert.equal(JSON.stringify(repository.rentalHistory), history);
  assert.equal(JSON.stringify(repository.books.get(archivedBookId)), untouchedBook);
});

test('missing books return JSON 404 for GET, PATCH and DELETE', async (t) => {
  const { request } = await setup(t);
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const response = await request(`/${missingBookId}`, method, method === 'PATCH' ? { title: 'Missing' } : undefined);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: 'BOOK_NOT_FOUND', message: 'Book not found' } });
  }
});

test('invalid UUIDs return 400 without calling the repository', async (t) => {
  const { repository, request } = await setup(t);
  const find = t.mock.method(repository, 'findById');
  const update = t.mock.method(repository, 'update');
  const archive = t.mock.method(repository, 'archive');
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const response = await request('/invalid-uuid', method, method === 'PATCH' ? { title: 'Bad' } : undefined);
    assert.equal(response.status, 400);
    assert.equal((await readError(response)).error.code, 'VALIDATION_ERROR');
  }
  assert.equal(find.mock.callCount() + update.mock.callCount() + archive.mock.callCount(), 0);
});

test('invalid query parameters, arrays, empty search and excessive pagination are rejected', async (t) => {
  const { repository, request } = await setup(t);
  const list = t.mock.method(repository, 'list');
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page=1000001', 'pageSize=101', 'pageSize=0', 'pageSize=', 'page=1&page=2', 'search=', 'author=%20', 'includeArchived=1', 'includeArchived=', 'title[x]=bad', 'unknown=value']) {
    const response = await request(`?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal((await readError(response)).error.code, 'VALIDATION_ERROR');
  }
  assert.equal(list.mock.callCount(), 0);
});

test('create and patch reject negative, numeric, over-precision, overflow and non-decimal money', async (t) => {
  const { repository, request } = await setup(t);
  const original = JSON.stringify([...repository.books.values()]);
  for (const money of ['-1', '-0.00', '1.001', '10000000000.00', 'NaN', 'Infinity', '1e2', '1,50', ' 1.00', '+1', '01.50', '.50', '', null, 12.5, 0]) {
    for (const field of ['dailyPrice', 'depositAmount']) {
      for (const method of ['POST', 'PATCH']) {
        const body = method === 'POST' ? { ...validBookInput, [field]: money } : { [field]: money };
        const response = await request(method === 'POST' ? '' : `/${bookId}`, method, body);
        assert.equal(response.status, 400, `${method} ${field} ${String(money)}`);
        assert.equal((await readError(response)).error.code, 'VALIDATION_ERROR');
      }
    }
  }
  assert.equal(JSON.stringify([...repository.books.values()]), original);
});

test('strict bodies reject missing fields, empty text, system fields and nested relation writes', async (t) => {
  const { request } = await setup(t);
  for (const field of ['title', 'author', 'genre']) {
    for (const value of ['', '  \n\t', null, 42, 'x'.repeat(1001)]) {
      for (const method of ['POST', 'PATCH']) {
        const response = await request(method === 'POST' ? '' : `/${bookId}`, method, method === 'POST' ? { ...validBookInput, [field]: value } : { [field]: value });
        assert.equal(response.status, 400);
        await response.arrayBuffer();
      }
    }
  }
  for (const extra of [{ id: missingBookId }, { archivedAt: null }, { copies: { deleteMany: {} } }, { rentals: [] }, { arbitrary: true }]) {
    for (const method of ['POST', 'PATCH']) {
      const response = await request(method === 'POST' ? '' : `/${bookId}`, method, { ...validBookInput, ...extra });
      assert.equal(response.status, 400);
      await response.arrayBuffer();
    }
  }
  for (const method of ['POST', 'PATCH']) {
    for (const body of [{}, [], null, 'text']) {
      const response = await request(method === 'POST' ? '' : `/${bookId}`, method, body);
      assert.equal(response.status, 400);
      await response.arrayBuffer();
    }
  }
  for (const field of Object.keys(validBookInput)) {
    const input: Record<string, unknown> = { ...validBookInput };
    delete input[field];
    const response = await request('', 'POST', input);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
});

test('librarians cannot write books despite spoofed role and forwarding headers', async (t) => {
  for (const environment of ['production', 'test'] as const) {
    const { repository, request } = await setup(t, environment, 'LIBRARIAN');
    const original = JSON.stringify([...repository.books.values()]);
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await request(method === 'POST' ? '' : `/${bookId}`, method, method === 'DELETE' ? undefined : validBookInput, {
        'X-Forwarded-For': '127.0.0.1', 'X-Role': 'ADMIN', Forwarded: 'for=127.0.0.1', Authorization: 'Bearer fake',
      });
      assert.equal(response.status, 403);
      assert.equal((await readError(response)).error.code, 'ROLE_FORBIDDEN');
    }
    assert.equal((await request()).status, 200);
    assert.equal(JSON.stringify([...repository.books.values()]), original);
  }
});

test('unexpected repository errors return 500 without PostgreSQL or Prisma details', async (t) => {
  const { repository, request } = await setup(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(repository, 'list', async () => { throw new Error('Prisma private database secret'); });
  const response = await request();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
});

test('role enforcement rejects mutations before malformed or oversized JSON is parsed', async (t) => {
  const { request, headers } = await setup(t, 'production', 'LIBRARIAN');
  // Resolve a URL without exposing the server fixture through the API helper.
  const catalog = await request();
  const url = catalog.url;
  await catalog.arrayBuffer();
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    for (const body of ['{', JSON.stringify({ value: 'x'.repeat(110_000) })]) {
      const response = await fetch(method === 'POST' ? url : `${url}/${bookId}`, {
        method, headers, body,
      });
      assert.equal(response.status, 403);
      assert.equal((await readError(response)).error.code, 'ROLE_FORBIDDEN');
    }
  }
});
