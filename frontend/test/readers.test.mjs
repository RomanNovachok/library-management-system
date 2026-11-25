import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { isReaderResponse, isReadersResponse, isReaderCategoriesResponse, isReaderRentalsResponse } from '../src/api/reader-contract.ts';
import { readerListQuery, validateReaderInput } from '../src/utils/reader-forms.ts';

const id = 'f3488667-8cf7-41df-923e-224296c84711';
const otherId = 'f3488667-8cf7-41df-923e-224296c84712';
const category = { id, name: 'Умовна категорія', discountPercent: '12.50' };
const input = { fullName: 'Тестовий Читач', address: 'Умовна адреса 1', phone: '+380 (00) 000-00-00', categoryId: id };
const reader = { ...input, id, category };
const pagination = { page: 1, pageSize: 20, total: 1, totalPages: 1 };
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false,
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', define: { 'import.meta.env.VITE_API_URL': JSON.stringify('https://api.example.test/api') },
});
after(() => vite.close());
const api = await vite.ssrLoadModule('/src/api/readers.ts');

test('reader form validates required fields, broad phone formats and category membership', () => {
  assert.deepEqual(validateReaderInput({ ...input, fullName: ` ${input.fullName} ` }, [category]), { data: input, errors: {} });
  for (const [key, values] of Object.entries({ fullName: ['', 'x', 'x'.repeat(201), 'Test\0Name'], address: ['', 'xx', 'x'.repeat(501)], phone: ['', '123', 'letters', '0'.repeat(16), '12+345678'], categoryId: ['', otherId] })) {
    for (const value of values) assert.ok(validateReaderInput({ ...input, [key]: value }, [category]).errors[key], `${key}: ${value}`);
  }
  for (const phone of ['+380 (00) 000-00-00', '000 000 00 00', '000-00-00', '+1.000.000.0000']) assert.ok(validateReaderInput({ ...input, phone }, [category]).data);
  assert.equal(validateReaderInput(input, []).data, undefined);
});

test('reader contracts check category/identity, discount decimal, pages and empty rental history', () => {
  assert.ok(isReaderResponse({ data: reader }));
  assert.ok(isReadersResponse({ data: [reader], pagination }));
  assert.ok(isReaderCategoriesResponse({ data: [category, { ...category, id: otherId, name: 'Нова категорія з БД', discountPercent: '100.00' }] }));
  assert.ok(isReaderRentalsResponse({ data: [], pagination: { ...pagination, total: 0, totalPages: 0 } }));
  for (const change of [{ categoryId: otherId }, { phone: 123 }, { id: '../bad' }, { category: { ...category, discountPercent: 12.5 } }, { category: { ...category, discountPercent: '100.01' } }]) assert.equal(isReaderResponse({ data: { ...reader, ...change } }), false);
  assert.equal(isReadersResponse({ data: [reader], pagination: { ...pagination, totalPages: 4 } }), false);
  const rental = { id, readerId: id, status: 'ACTIVE', issuedAt: '2026-01-01T00:00:00Z', dueAt: '2026-01-02T00:00:00Z', closedAt: null, bookTitle: 'Умовна книга', inventoryCode: 'TEST-1' };
  assert.ok(isReaderRentalsResponse({ data: [rental], pagination }));
  for (const status of ['RETURNED', 'LOST']) assert.ok(isReaderRentalsResponse({ data: [{ ...rental, status, closedAt: '2026-01-02T00:00:00Z' }], pagination }));
  assert.equal(isReaderRentalsResponse({ data: [{ ...rental, status: 'UNKNOWN' }], pagination }), false);
});

test('reader URL query preserves filters and accepts only bounded positive pagination', () => {
  assert.deepEqual(readerListQuery(new URLSearchParams(`search=Тест&categoryId=${id}&page=2&pageSize=50`)), { search: 'Тест', categoryId: id, page: 2, pageSize: 50 });
  for (const value of ['0', '-1', '1.5', '1000001', 'bad']) assert.equal(readerListQuery(new URLSearchParams({ page: value })).page, 1);
  assert.equal(readerListQuery(new URLSearchParams('pageSize=101')).pageSize, 20);
});

test('Readers API loads lists, search/filter pages, categories, details and history using the shared client', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.includes('reader-categories')) return Response.json({ data: [category] });
    if (url.includes('/rentals')) return Response.json({ data: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
    if (url.includes('/readers?')) return Response.json({ data: [reader], pagination: { ...pagination, page: 2, pageSize: 1, total: 2, totalPages: 2 } });
    return Response.json({ data: reader });
  });
  const signal = new AbortController().signal;
  await api.getReaders({ search: '+000', categoryId: id, page: 2, pageSize: 1 }, signal);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('search'), '+000');
  assert.equal(url.searchParams.get('categoryId'), id);
  assert.equal(url.searchParams.get('page'), '2');
  assert.deepEqual(await api.getReaderCategories(signal), [category]);
  assert.deepEqual(await api.getReader(id, signal), reader);
  assert.deepEqual((await api.getReaderRentals(id, { page: 1, pageSize: 20 }, signal)).data, []);
});

test('Readers API creates and partially edits profiles without sending relation or system fields', async (t) => {
  for (const [method, body] of [['POST', input], ['PATCH', { categoryId: otherId }]]) {
    const mock = t.mock.method(globalThis, 'fetch', async (_url, options) => {
      assert.equal(options.method, method);
      assert.deepEqual(JSON.parse(options.body), body);
      return Response.json({ data: reader }, { status: method === 'POST' ? 201 : 200 });
    });
    const signal = new AbortController().signal;
    await (method === 'POST' ? api.createReader(body, signal) : api.updateReader(id, body, signal));
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test('Readers API handles HTTP, connection, invalid category, malformed and mismatched responses without retries', async (t) => {
  for (const [status, code] of [[400, 'READER_CATEGORY_NOT_FOUND'], [403, 'ROLE_FORBIDDEN'], [404, 'READER_NOT_FOUND'], [409, 'READER_WRITE_CONFLICT'], [500, 'INTERNAL_SERVER_ERROR']]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code } }, { status }));
    await assert.rejects(api.createReader(input, new AbortController().signal), (error) => error.status === status && error.code === code && /[А-ЯІЇЄа-яіїє]/.test(error.message));
    mock.mock.restore();
  }
  for (const value of [undefined, { data: { ...reader, category: { ...category, discountPercent: 12.5 } } }]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => { if (!value) throw new TypeError('Offline'); return Response.json(value); });
    await assert.rejects(api.createReader(input, new AbortController().signal), (error) => error.outcomeUnknown);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: { ...reader, id: otherId } }));
  await assert.rejects(api.getReader(id, new AbortController().signal), /іншого читача/);
});
