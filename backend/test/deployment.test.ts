import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { cloudTarget } from '../prisma/cloud-library.js';
import { createApp } from '../src/app.js';
import { readDatabaseUrl } from '../src/config/database-url.js';
import { LoginLimit } from '../src/modules/auth/login-limit.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { MemoryAuthRepository, staffRequestHeaders } from './helpers/auth.repository.js';
import { MemoryBooksRepository, validBookInput } from './helpers/books.repository.js';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('the fixed-origin proxy preserves session cookies, CSRF, API headers, query, methods and errors', async () => {
  const origin = 'https://library.example.test';
  const auth = new MemoryAuthRepository();
  const password = 'Fixture account password 123!';
  const user = await auth.createAccount({ email: 'admin@example.test', role: 'ADMIN', passwordHash: await hashPassword(password) });
  const app = createApp({ CORS_ORIGIN: origin, NODE_ENV: 'production', LOGIN_BEHIND_PROXY: true }, {
    authRepository: auth, booksRepository: new MemoryBooksRepository(),
    checkReadiness: async () => { throw new Error('database details'); },
  });
  const backend = createServer(app);
  const upstream = await listen(backend);
  const proxy = createServer((req, res) => {
    const forwarded = request(`${upstream}${req.url}`, { method: req.method, headers: req.headers }, (result) => {
      res.writeHead(result.statusCode!, result.headers);
      result.pipe(res);
    });
    req.pipe(forwarded);
  });
  try {
    const base = await listen(proxy);
    let cookie: string | undefined;
    const call = async (path: string, method = 'GET', body?: object, extra = {}) => {
      const response = await fetch(`${base}/api${path}`, {
        method, headers: { ...staffRequestHeaders(origin, cookie), ...extra },
        ...(body && { body: JSON.stringify(body) }),
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return response;
    };
    const credentials = { email: user.email, password };
    assert.equal((await call('/auth/login', 'POST', credentials, { Origin: 'https://different.example.test' })).status, 403);
    const login = await call('/auth/login', 'POST', credentials);
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { id: user.id, email: user.email, role: user.role });
    const setCookie = login.headers.get('set-cookie')!;
    assert.match(setCookie, /^__Secure-library_session=[\w-]{43};/);
    for (const attribute of ['Path=/api', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(setCookie.split('; ').includes(attribute));
    assert.doesNotMatch(setCookie, /; Domain=/i);
    cookie = setCookie.split(';')[0]!;
    assert.deepEqual(await (await call('/auth/me')).json(), { id: user.id, email: user.email, role: user.role });

    const created = await call('/books', 'POST', validBookInput);
    assert.equal(created.status, 201);
    const { data: book } = await created.json() as { data: { id: string } };
    const search = await (await call('/books?search=New%20Book&pageSize=1')).json() as {
      data: { id: string }[]; pagination: { total: number };
    };
    assert.equal(search.pagination.total, 1);
    assert.equal(search.data[0]?.id, book.id);
    assert.equal((await call(`/books/${book.id}`, 'PATCH', { dailyPrice: '13.00' })).status, 200);
    assert.equal((await call(`/books/${book.id}`, 'DELETE')).status, 204);
    const invalidTerms = await call('/rentals', 'POST', {}, { 'X-Rental-Terms': 'invalid-test-value' });
    assert.equal(invalidTerms.status, 400);
    assert.match((await invalidTerms.json() as { error: { message: string } }).error.message, /заголов|header|64|Invalid/i);
    const missing = await call('/missing');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as { error: { code: string } }).error.code, 'NOT_FOUND');

    const logout = await call('/auth/logout', 'POST');
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie')!, /^__Secure-library_session=; Path=\/api;/);
    assert.equal((await call('/auth/me')).status, 401);
    const readiness = await call('/ready');
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), { status: 'unavailable' });
    assert.deepEqual(await (await call('/health')).json(), { status: 'ok' });
  } finally {
    await Promise.all([proxy, backend].map((server) => new Promise<void>((resolve) => { server.close(() => resolve()); })));
  }
});

test('a shared proxy retains the account and global login limits without a socket-IP limit', () => {
  const direct = new LoginLimit();
  for (let n = 0; n < 40; n++) direct.take(`staff${n}`, '127.0.0.1', 0);
  assert.throws(() => direct.take('another-account', '127.0.0.1', 0), { status: 429 });
  const proxy = new LoginLimit();
  for (let n = 0; n < 8; n++) proxy.take('same-account', undefined, 0);
  assert.throws(() => proxy.take('same-account', undefined, 0), { status: 429 });
  for (let n = 0; n < 292; n++) proxy.take(`staff${n}`, undefined, 0);
  assert.throws(() => proxy.take('another-account', undefined, 0), { status: 429 });
  proxy.take('same-account', undefined, 900_000);
});

test('cloud initialization accepts only a verified, direct Neon target', () => {
  const direct = 'postgresql://test_owner:placeholder@ep-test.us-east-2.aws.neon.tech/library?sslmode=verify-full&channel_binding=require';
  assert.deepEqual(cloudTarget({ DATABASE_URL: direct }), {
    database: 'library', username: 'test_owner', endpoint: 'ep-test.us-east-2.aws.neon.tech/library',
  });
  for (const url of [direct.replace('ep-test.', 'ep-test-pooler.'), direct.replace('verify-full', 'require'),
    direct.replace('.neon.tech', '.example.test'), `${direct}&host=localhost`, `${direct}&schema=other`]) {
    assert.throws(() => cloudTarget({ DATABASE_URL: url }));
  }
  assert.throws(() => readDatabaseUrl({ DATABASE_URL: direct, NODE_ENV: 'production', NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /TLS certificate/);
});
