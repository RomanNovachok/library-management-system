import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { z } from 'zod';
import { createApp, type ApiConfig } from '../src/app.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { sessionHash } from '../src/modules/auth/auth.service.js';
import { StaffService } from '../src/modules/staff/staff.service.js';
import { MemoryAuthRepository, staffRequestHeaders } from './helpers/auth.repository.js';
import { MemoryBooksRepository, bookId } from './helpers/books.repository.js';
import { MemoryBookCopiesRepository, copiesBookId, absentId } from './helpers/book-copies.repository.js';
import { MemoryReadersRepository, missingId } from './helpers/readers.repository.js';

const origin = 'https://frontend.example.test';
const password = 'Staff fixture password 7!';
const replacement = 'Updated fixture password 9!';
const passwordHash = await hashPassword(password);
const accountJson = z.strictObject({ id: z.uuid(), email: z.email(), role: z.enum(['ADMIN', 'LIBRARIAN']), isActive: z.boolean() });

async function setup(t: TestContext, config: Partial<ApiConfig> = {}) {
  let timestamp = Date.now();
  const repository = new MemoryAuthRepository();
  const add = (email: string, role: 'ADMIN' | 'LIBRARIAN' = 'LIBRARIAN') => repository.createAccount({ email, role, passwordHash });
  const admin = await add('admin@example.test', 'ADMIN');
  const librarian = await add('librarian@example.test');
  const server = createApp({ CORS_ORIGIN: origin, SESSION_TTL_SECONDS: 60, ...config }, {
    authRepository: repository, now: () => new Date(timestamp),
    booksRepository: new MemoryBooksRepository(),
    bookCopiesRepository: new MemoryBookCopiesRepository(),
    readersRepository: new MemoryReadersRepository(),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const request = (path: string, method = 'GET', body?: unknown, cookie?: string, headers: Record<string, string> = staffRequestHeaders(origin, cookie)) =>
    fetch(base + path, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const login = (email: string, value = password) => request('/auth/login', 'POST', { email, password: value });
  const signIn = async (email: string, value = password) => cookieOf(await login(email, value));
  return { request, login, signIn, add, repository, admin, librarian, advance: (ms: number) => { timestamp += ms; } };
}

function cookieOf(response: Response) {
  assert.equal(response.status, 200);
  const header = response.headers.get('set-cookie');
  assert.ok(header);
  return header.split(';')[0]!;
}

async function expectStatus(response: Response, status: number, code?: string) {
  assert.equal(response.status, status);
  if (code) assert.equal(z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code, code);
  else await response.arrayBuffer();
}

test('login normalizes email, only persists the session digest, and expires at the configured cutoff', async (t) => {
  const { request, login, repository, librarian, advance } = await setup(t);
  const response = await login(' LIBRARIAN@EXAMPLE.TEST ');
  const cookie = cookieOf(response);
  const token = cookie.split('=')[1]!;
  const header = response.headers.get('set-cookie')!;
  assert.match(token, /^[a-zA-Z0-9_-]{43}$/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Path=\/api/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=60/);
  assert.doesNotMatch(header, /; (?:Secure|Domain=)/);
  assert.deepEqual(await response.json(), { id: librarian.id, email: librarian.email, role: librarian.role });
  assert.deepEqual([...repository.sessions.keys()], [sessionHash(token)]);
  await expectStatus(await request('/auth/me', 'GET', undefined, `${cookie}; ${cookie}`), 401, 'AUTH_REQUIRED');
  advance(59_999);
  await expectStatus(await request('/auth/me', 'GET', undefined, cookie), 200);
  advance(1);
  await expectStatus(await request('/auth/me', 'GET', undefined, cookie), 401, 'AUTH_REQUIRED');
  await login(librarian.email);
  assert.ok(!repository.sessions.has(sessionHash(token)));
});

test('incorrect passwords, unknown emails and inactive accounts return the same safe error', async (t) => {
  const { login, repository, librarian } = await setup(t);
  const unknown = await login('missing@example.test');
  const wrong = await login(librarian.email, 'incorrect');
  await repository.updateAccount(librarian.id, { isActive: false });
  const inactive = await login(librarian.email);
  for (const response of [unknown, wrong, inactive]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
  }
  assert.equal(repository.sessions.size, 0);
});

test('login rotates the presented session and idempotent logout revokes its latest token', async (t) => {
  const { request, signIn, librarian } = await setup(t, { NODE_ENV: 'production', SESSION_COOKIE_SAME_SITE: 'none' });
  const old = await signIn(librarian.email);
  const rotated = await request('/auth/login', 'POST', { email: librarian.email, password }, old);
  const current = cookieOf(rotated);
  assert.notEqual(old, current);
  assert.match(rotated.headers.get('set-cookie')!, /^__Secure-library_session=.*; HttpOnly; Secure; SameSite=None$/);
  await expectStatus(await request('/auth/me', 'GET', undefined, old), 401);
  const logout = await request('/auth/logout', 'POST', undefined, current);
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie')!, /^__Secure-library_session=; Path=\/api; Expires=.*; HttpOnly; Secure; SameSite=None$/);
  await expectStatus(await request('/auth/me', 'GET', undefined, current), 401);
  await expectStatus(await request('/auth/logout', 'POST', undefined, current), 204);
  await expectStatus(await request('/auth/logout', 'POST'), 204);
});

test('password changes verify the old password and policy before revoking all sessions', async (t) => {
  const { request, signIn, login, librarian } = await setup(t);
  const first = await signIn(librarian.email);
  const second = await signIn(librarian.email);
  await expectStatus(await request('/auth/change-password', 'POST', { oldPassword: 'wrong', newPassword: replacement }, first), 400, 'WRONG_OLD_PASSWORD');
  await expectStatus(await request('/auth/change-password', 'POST', { oldPassword: password, newPassword: 'weak' }, first), 400, 'AUTH_VALIDATION_ERROR');
  await expectStatus(await request('/auth/me', 'GET', undefined, first), 200);
  await expectStatus(await request('/auth/change-password', 'POST', { oldPassword: password, newPassword: replacement }, first), 204);
  for (const cookie of [first, second]) await expectStatus(await request('/auth/me', 'GET', undefined, cookie), 401);
  await expectStatus(await login(librarian.email), 401);
  await signIn(librarian.email, replacement);
});

test('per-account limit survives casing and spoofed forwarding headers, and the window expires', async (t) => {
  const { request, signIn, librarian, advance } = await setup(t);
  for (let attempt = 0; attempt < 8; attempt++) {
    await expectStatus(await request('/auth/login', 'POST', { email: librarian.email.toUpperCase(), password: 'wrong' }, undefined,
      { ...staffRequestHeaders(origin), 'X-Forwarded-For': `192.0.2.${attempt}` }), 401);
  }
  await expectStatus(await request('/auth/login', 'POST', { email: librarian.email, password }), 429, 'LOGIN_RATE_LIMITED');
  advance(15 * 60 * 1000);
  await signIn(librarian.email);
});

test('CSRF requires exact Origin and custom header for login, logout and authenticated writes', async (t) => {
  const { request, signIn, admin } = await setup(t);
  const cookie = await signIn(admin.email);
  for (const headers of [
    { 'X-Library-Request': '1' }, { Origin: origin },
    { Origin: 'null', 'X-Library-Request': '1' },
    { Origin: origin + '.other.test', 'X-Library-Request': '1' },
  ]) {
    for (const path of ['/auth/login', '/auth/logout', '/auth/change-password', '/staff', '/books', '/readers']) {
      await expectStatus(await request(path, 'POST', {}, cookie, { Cookie: cookie, ...headers }), 403, 'CSRF_REJECTED');
    }
  }
  await expectStatus(await request('/auth/me', 'GET', undefined, cookie), 200);
});

test('all catalog, readers, staff and private auth methods reject requests without a session', async (t) => {
  const { request } = await setup(t);
  const copies = `/books/${copiesBookId}/copies`;
  for (const [method, path] of [
    ['GET', '/books'], ['GET', `/books/${bookId}`], ['POST', '/books'], ['PATCH', `/books/${bookId}`], ['DELETE', `/books/${bookId}`],
    ['GET', copies], ['GET', `${copies}/${absentId}`], ['POST', copies], ['PATCH', `${copies}/${absentId}`], ['DELETE', `${copies}/${absentId}`],
    ['GET', '/readers'], ['GET', `/readers/${missingId}`], ['GET', `/readers/${missingId}/rentals`], ['GET', '/reader-categories'],
    ['POST', '/readers'], ['PATCH', `/readers/${missingId}`], ['GET', '/staff'], ['POST', '/staff'],
    ['PATCH', `/staff/${missingId}`], ['POST', `/staff/${missingId}/reset-password`], ['GET', '/auth/me'], ['POST', '/auth/change-password'],
  ] as const) {
    await expectStatus(await request(path, method), 401, 'AUTH_REQUIRED');
  }
});

test('staff administration normalizes email, enforces role and revokes sessions on security changes', async (t) => {
  const { request, signIn, login, admin, librarian } = await setup(t);
  const adminCookie = await signIn(admin.email);
  const librarianCookie = await signIn(librarian.email);
  for (const [method, path] of [['GET', '/staff'], ['POST', '/staff'], ['PATCH', `/staff/${admin.id}`], ['POST', `/staff/${admin.id}/reset-password`]] as const) {
    await expectStatus(await request(path, method, method === 'GET' ? undefined : {}, librarianCookie), 403, 'ROLE_FORBIDDEN');
  }
  const body = { email: '  NEW@EXAMPLE.TEST  ', role: 'ADMIN', password };
  const response = await request('/staff', 'POST', body, adminCookie);
  assert.equal(response.status, 201);
  const created = accountJson.parse(await response.json());
  assert.deepEqual(created, { id: created.id, email: 'new@example.test', role: 'ADMIN', isActive: true });
  await expectStatus(await request('/staff', 'POST', body, adminCookie), 409, 'STAFF_EMAIL_EXISTS');
  const listed = z.array(accountJson).parse(await (await request('/staff', 'GET', undefined, adminCookie)).json());
  assert.equal(listed.length, 3);
  assert.ok(listed.every((item: object) => Object.keys(item).sort().join(',') === 'email,id,isActive,role'));
  const createdCookie = await signIn(created.email);
  await expectStatus(await request(`/staff/${created.id}`, 'PATCH', { role: 'LIBRARIAN' }, adminCookie), 200);
  await expectStatus(await request('/auth/me', 'GET', undefined, createdCookie), 401);
  const active = await signIn(created.email);
  await expectStatus(await request(`/staff/${created.id}/reset-password`, 'POST', { password: replacement }, adminCookie), 204);
  await expectStatus(await request('/auth/me', 'GET', undefined, active), 401);
  await expectStatus(await login(created.email), 401);
  const passwordUpdated = await signIn(created.email, replacement);
  await expectStatus(await request(`/staff/${created.id}`, 'PATCH', { isActive: false }, adminCookie), 200);
  await expectStatus(await request('/auth/me', 'GET', undefined, passwordUpdated), 401);
  await expectStatus(await login(created.email, replacement), 401);
  await expectStatus(await request(`/staff/${admin.id}`, 'PATCH', { isActive: false }, adminCookie), 409, 'LAST_ACTIVE_ADMIN');
  await expectStatus(await request(`/staff/${admin.id}`, 'PATCH', { role: 'LIBRARIAN' }, adminCookie), 409, 'LAST_ACTIVE_ADMIN');
});

test('concurrent administrator changes preserve an active administrator and recheck the acting session', async (t) => {
  const { request, signIn, add, repository, admin } = await setup(t);
  const second = await add('second@example.test', 'ADMIN');
  const firstCookie = await signIn(admin.email);
  const secondCookie = await signIn(second.email);
  const responses = await Promise.all([
    request(`/staff/${second.id}`, 'PATCH', { isActive: false }, firstCookie),
    request(`/staff/${admin.id}`, 'PATCH', { role: 'LIBRARIAN' }, secondCookie),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
  await Promise.all(responses.map((response) => response.arrayBuffer()));
  assert.equal(await repository.countActiveAdmins(), 1);
});

test('concurrent self-deactivation rejects the operation that would remove the last administrator', async (t) => {
  const { request, signIn, add, repository, admin } = await setup(t);
  const second = await add('second@example.test', 'ADMIN');
  const firstCookie = await signIn(admin.email);
  const secondCookie = await signIn(second.email);
  const responses = await Promise.all([
    request(`/staff/${admin.id}`, 'PATCH', { isActive: false }, firstCookie),
    request(`/staff/${second.id}`, 'PATCH', { isActive: false }, secondCookie),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  for (const response of responses) {
    await expectStatus(response, response.status, response.status === 409 ? 'LAST_ACTIVE_ADMIN' : undefined);
  }
  assert.equal(await repository.countActiveAdmins(), 1);
});

test('concurrent bootstrap creates only one active ADMIN', async () => {
  const repository = new MemoryAuthRepository();
  const service = new StaffService(repository);
  const result = await Promise.allSettled([
    service.bootstrap('one@example.test', password), service.bootstrap('two@example.test', password),
  ]);
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
  const failure = result.find((item) => item.status === 'rejected');
  assert.equal(failure?.reason.code, 'ADMIN_ALREADY_EXISTS');
  assert.equal(await repository.countActiveAdmins(), 1);
});
