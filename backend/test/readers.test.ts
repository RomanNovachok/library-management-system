import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { z } from 'zod';
import type { TestContext } from 'node:test';
import { createApp } from '../src/app.js';
import { categoryId, MemoryReadersRepository, missingId, otherCategoryId, validReaderInput } from './helpers/readers.repository.js';
import type { Env } from '../src/config/env.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaReadersRepository } from '../src/modules/readers/readers.repository.js';

const categoryJson = z.object({ id: z.uuid(), name: z.string(), discountPercent: z.string() });
const readerJson = z.object({ id: z.uuid(), fullName: z.string(), address: z.string(), phone: z.string(), categoryId: z.uuid(), category: categoryJson });
const readReader = async (response: Response) => z.object({ data: readerJson }).parse(await response.json());
const readPage = async (response: Response) => z.object({ data: z.array(readerJson), pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }) }).parse(await response.json());

async function setup(t: TestContext, environment: Env['NODE_ENV'] = 'development') {
  const repository = new MemoryReadersRepository();
  const server = createApp({ CORS_ORIGIN: 'https://frontend.example.test', NODE_ENV: environment }, { readersRepository: repository }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const request = (path = '/readers', method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method,
    headers: { 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { repository, request, base };
}

test('registers, returns details/current category and partially updates all editable reader fields', async (t) => {
  const { repository, request } = await setup(t);
  const created = await request('/readers', 'POST', { ...validReaderInput, fullName: ` ${validReaderInput.fullName} ` });
  assert.equal(created.status, 201);
  const { data } = await readReader(created);
  assert.equal(data.fullName, validReaderInput.fullName);
  assert.equal(data.category.discountPercent, '0.00');
  assert.equal(created.headers.get('location'), `/api/readers/${data.id}`);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await readReader(await request(`/readers/${data.id.toUpperCase()}`))).data, data);
  for (const patch of [{ fullName: 'Умовний Читач' }, { address: 'Умовна адреса 2' }, { phone: '000 000 00 02' }, { categoryId: otherCategoryId }]) {
    const previous = await repository.findById(data.id);
    const response = await request(`/readers/${data.id}`, 'PATCH', patch);
    assert.equal(response.status, 200);
    const edited = (await readReader(response)).data;
    for (const field of ['fullName', 'address', 'phone', 'categoryId'] as const) assert.equal(edited[field], field in patch ? patch[field as keyof typeof patch] : previous![field]);
  }
  assert.equal((await readReader(await request(`/readers/${data.id}`))).data.category.discountPercent, '12.50');
  repository.categoryRows[1]!.discountPercent = new Prisma.Decimal('15.25');
  assert.equal((await readReader(await request(`/readers/${data.id}`))).data.category.discountPercent, '15.25');
  assert.equal((await request(`/readers/${data.id}`, 'DELETE')).status, 404);
  assert.ok(await repository.findById(data.id));
});

test('lists categories from repository, searches both fields, filters and paginates with stable ordering', async (t) => {
  const { repository, request } = await setup(t);
  for (const input of [validReaderInput, { ...validReaderInput, fullName: 'Тестовий Читач Бета', categoryId: otherCategoryId }, { ...validReaderInput }]) await repository.create(input);
  const categories = z.object({ data: z.array(categoryJson) }).parse(await (await request('/reader-categories')).json());
  assert.deepEqual(categories.data.map((row: { discountPercent: string }) => row.discountPercent), ['0.00', '12.50']);
  const list = await readPage(await request('/readers?search=тестовий&pageSize=1&page=2'));
  assert.equal(list.data.length, 1);
  assert.deepEqual(list.pagination, { page: 2, pageSize: 1, total: 3, totalPages: 3 });
  assert.deepEqual(await (await request('/readers?search=тестовий&pageSize=1&page=2')).json(), list);
  assert.equal((await readPage(await request(`/readers?search=000-00&categoryId=${categoryId}`))).pagination.total, 2);
  assert.equal((await readPage(await request('/readers?search=Невідомий'))).data.length, 0);
  assert.equal((await readPage(await request('/readers?page=999'))).data.length, 0);
});

test('validates UUID, strict fields, text limits, phone formats and missing categories without writes', async (t) => {
  const { repository, request } = await setup(t);
  const row = await repository.create(validReaderInput);
  for (const patch of [{}, { id: missingId }, { rentals: [] }, { fullName: '' }, { fullName: 'x' }, { fullName: 'x'.repeat(201) }, { address: '  ' }, { address: 'x'.repeat(501) }, { address: 'Test\0address' }, { phone: 1234567 }, { phone: 'letters' }, { phone: '+1+234567' }, { phone: '000000' }, { phone: '0'.repeat(16) }, { categoryId: 'bad' }, { categoryId: missingId }, { fullName: null }, { archivedAt: null }]) {
    const response = await request(`/readers/${row.id}`, 'PATCH', patch);
    assert.equal(response.status, 400, JSON.stringify(patch));
  }
  for (const input of [{}, { ...validReaderInput, extra: true }, { ...validReaderInput, categoryId: missingId }]) assert.equal((await request('/readers', 'POST', input)).status, 400);
  assert.deepEqual(await repository.findById(row.id), row);
  for (const suffix of ['?page=0', '?page=1.5', '?page=1000001', '?pageSize=101', '?pageSize=-1', '?search=', '?search=a&search=b', '?categoryId=bad', '?unknown=1', `?search=${'x'.repeat(201)}`]) assert.equal((await request(`/readers${suffix}`)).status, 400, suffix);
  for (const path of ['/readers/bad', '/readers/bad/rentals', '/reader-categories?unknown=1', `/readers/${row.id}?unknown=1`, `/readers/${row.id}/rentals?search=bad`]) assert.equal((await request(path)).status, 400);
  assert.equal((await request('/readers?unknown=1', 'POST', validReaderInput)).status, 400);
  assert.equal((await request(`/readers/${row.id}?unknown=1`, 'PATCH', { phone: '0000000' })).status, 400);
  for (const path of [`/readers/${missingId}`, `/readers/${missingId}/rentals`]) assert.equal((await request(path)).status, 404);
  assert.equal((await request(`/readers/${missingId}`, 'PATCH', { phone: '0000000' })).status, 404);
  for (const phone of ['+380 (00) 000-00-00', '000 000 00 00', '000-00-00', '+1.000.000.0000']) assert.equal((await request('/readers', 'POST', { ...validReaderInput, phone })).status, 201);
});

test('rental history is paginated, scoped, stable and empty for a new reader', async (t) => {
  const { repository, request } = await setup(t);
  const row = await repository.create(validReaderInput);
  const historySchema = z.object({ data: z.array(z.object({ bookTitle: z.string() }).passthrough()), pagination: z.object({ total: z.number() }) });
  const empty = historySchema.parse(await (await request(`/readers/${row.id}/rentals`)).json());
  assert.deepEqual(empty.data, []);
  assert.equal(empty.pagination.total, 0);
  for (const status of ['ACTIVE', 'RETURNED', 'LOST'] as const) repository.rentalRows.push({
    id: randomUUID(), readerId: row.id, status, issuedAt: new Date('2026-01-01Z'), dueAt: new Date('2026-01-02Z'), closedAt: status === 'ACTIVE' ? null : new Date('2026-01-02Z'),
    copy: { inventoryCode: `TEST-${status}`, book: { title: 'Умовна книга' } },
  });
  repository.rentalRows.push({ ...repository.rentalRows[0]!, id: randomUUID(), readerId: missingId });
  const before = JSON.stringify(repository.rentalRows);
  const history = historySchema.parse(await (await request(`/readers/${row.id}/rentals?pageSize=2&page=2`)).json());
  assert.equal(history.data.length, 1);
  assert.equal(history.pagination.total, 3);
  assert.equal(history.data[0]!.bookTitle, 'Умовна книга');
  assert.ok(!('copy' in history.data[0]!));
  await request(`/readers/${row.id}`, 'PATCH', { categoryId: otherCategoryId });
  assert.equal(JSON.stringify(repository.rentalRows), before);
});

test('production and test deny every Readers endpoint before parsing bodies or accessing repositories', async (t) => {
  for (const environment of ['production', 'test'] as const) {
    const { repository, base } = await setup(t, environment);
    const list = t.mock.method(repository, 'list');
    for (const [path, method] of [['/readers', 'GET'], ['/readers', 'POST'], [`/readers/${missingId}`, 'GET'], [`/readers/${missingId}`, 'PATCH'], [`/readers/${missingId}/rentals`, 'GET'], ['/reader-categories', 'GET']] as const) {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '127.0.0.1', 'X-Role': 'ADMIN' }, ...(['POST', 'PATCH'].includes(method!) && { body: '{' }) });
      assert.equal(response.status, 403);
      assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code, 'ADMIN_ACCESS_FORBIDDEN');
    }
    assert.equal(list.mock.callCount(), 0);
  }
});

test('concurrent disjoint partial updates preserve both changes', async (t) => {
  const { repository, request } = await setup(t);
  const row = await repository.create(validReaderInput);
  const responses = await Promise.all([
    request(`/readers/${row.id}`, 'PATCH', { address: 'Умовна нова адреса' }),
    request(`/readers/${row.id}`, 'PATCH', { phone: '0000000002' }),
  ]);
  for (const response of responses) assert.equal(response.status, 200);
  const final = await repository.findById(row.id);
  assert.equal(final?.address, 'Умовна нова адреса');
  assert.equal(final?.phone, '0000000002');
});

test('repository failures omit personal data and query arguments from technical logs', async (t) => {
  const { request } = await setup(t);
  const repository = new PrismaReadersRepository({ reader: { findUnique: async () => { throw new Error('private-address phone query'); } } } as unknown as Prisma.TransactionClient);
  await assert.rejects(repository.findById(missingId), (error: unknown) => error instanceof Error && error.message === 'Readers database operation failed' && error.cause === undefined);
  assert.equal((await request('/readers')).status, 200);
});

test('repository maps missing reader, category FK races and serialization conflicts to safe API errors', async () => {
  for (const [code, status, apiCode] of [['P2025', 404, 'READER_NOT_FOUND'], ['P2003', 409, 'READER_CATEGORY_CONFLICT'], ['P2034', 409, 'READER_WRITE_CONFLICT']] as const) {
    const repository = new PrismaReadersRepository({ reader: { update: async () => {
      throw new Prisma.PrismaClientKnownRequestError('Query with private contact arguments', { code, clientVersion: '7.10.1' });
    } } } as unknown as Prisma.TransactionClient);
    await assert.rejects(repository.update(missingId, { phone: '0000000000' }), (error: unknown) => error instanceof Error && 'status' in error && error.status === status && 'code' in error && error.code === apiCode && !error.message.includes('private'));
  }
});
