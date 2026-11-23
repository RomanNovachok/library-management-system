import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Load the existing TypeScript/Vite modules. Every fetch is replaced; these tests never access a database.
const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false,
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('https://api.example.test/api') },
});
after(() => vite.close());
const api = await vite.ssrLoadModule('/src/api/books.ts');
const { ApiError } = await vite.ssrLoadModule('/src/api/client.ts');
const id = 'c7c0e4b4-87c4-4c6a-a841-18fdbed10002';
const copyId = '9d633d29-b0b8-4caf-9781-8c4deff3cf93';
const input = { title: 'Книга', author: 'Автор', genre: 'Роман', dailyPrice: '4.50', depositAmount: '300.00' };
const book = { ...input, id, archivedAt: null };
const copy = { id: copyId, bookId: id, inventoryCode: 'INV', status: 'AVAILABLE' };

test('mutation endpoints serialize exact decimal strings and send each HTTP method once', async (t) => {
  const cases = [
    ['createBook', [input], 'POST', '/books', input, { data: book }],
    ['updateBook', [id, input], 'PATCH', `/books/${id}`, input, { data: { ...book, copies: [] } }],
    ['createBookCopy', [id, { inventoryCode: 'INV' }], 'POST', `/books/${id}/copies`, { inventoryCode: 'INV' }, { data: copy }],
    ['updateBookCopy', [id, copyId, { inventoryCode: 'NEW', status: 'MAINTENANCE' }], 'PATCH', `/books/${id}/copies/${copyId}`, { inventoryCode: 'NEW', status: 'MAINTENANCE' }, { data: { ...copy, inventoryCode: 'NEW', status: 'MAINTENANCE' } }],
    ['archiveBook', [id], 'DELETE', `/books/${id}`, undefined, undefined],
    ['deleteBookCopy', [id, copyId], 'DELETE', `/books/${id}/copies/${copyId}`, undefined, undefined],
  ];
  for (const [name, args, method, suffix, body, response] of cases) {
    await t.test(name, async (subtest) => {
      const signal = new AbortController().signal;
      const fetch = subtest.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url, `https://api.example.test/api${suffix}`);
        assert.equal(options.method, method);
        assert.equal(options.signal, signal);
        assert.equal(options.body, body === undefined ? undefined : JSON.stringify(body));
        assert.equal(options.headers['Content-Type'], body === undefined ? undefined : 'application/json');
        return response ? Response.json(response, { status: method === 'POST' ? 201 : 200 }) : new Response(null, { status: 204 });
      });
      assert.deepEqual(await api[name](...args, signal), response?.data);
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
});

test('400/403/404/409/500 keep structured status/code and Ukrainian messages', async (t) => {
  for (const [status, code] of [[400, 'VALIDATION_ERROR'], [403, 'ADMIN_ACCESS_FORBIDDEN'], [404, 'COPY_NOT_FOUND'], [409, 'INVENTORY_CODE_EXISTS'], [500, 'INTERNAL_SERVER_ERROR']]) {
    await t.test(String(status), async (subtest) => {
      subtest.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: 'Server message' } }, { status }));
      await assert.rejects(api.createBook(input, new AbortController().signal), (error) => error instanceof ApiError
        && error.status === status && error.code === code && /[А-ЯІЇЄа-яіїє]/.test(error.message));
    });
  }
});

test('network and malformed mutation responses mark an uncertain outcome and never auto-retry', async (t) => {
  for (const response of [undefined, '<html>broken json</html>', { data: { ...book, dailyPrice: 4.5 } }]) {
    await t.test(String(response), async (subtest) => {
      const fetch = subtest.mock.method(globalThis, 'fetch', async () => {
        if (response === undefined) throw new TypeError('Offline');
        return typeof response === 'string' ? new Response(response) : Response.json(response);
      });
      await assert.rejects(api.createBook(input, new AbortController().signal), (error) => error instanceof ApiError && error.outcomeUnknown);
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
});

test('DELETE expects an empty 204 and aborted requests preserve cancellation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: book }));
  await assert.rejects(api.archiveBook(id, new AbortController().signal), (error) => error.outcomeUnknown);
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', async (_url, options) => { options.signal.throwIfAborted(); });
  await assert.rejects(api.createBook(input, controller.signal), { name: 'AbortError' });
});
