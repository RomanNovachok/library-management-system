import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { assertLocalSeedTarget } from '../prisma/seed-library.js';
import { createApp } from '../src/app.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { prisma } from '../src/lib/prisma.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import { sessionHash } from '../src/modules/auth/auth.service.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { StaffService } from '../src/modules/staff/staff.service.js';
import { staffRequestHeaders } from '../test/helpers/auth.repository.js';
import { databaseSnapshot } from './database-snapshot.js';

const origin = 'http://localhost:5173';
const rollback = new Error('Roll back all authentication fixtures');
const accountJson = z.strictObject({ id: z.uuid(), email: z.email(), role: z.enum(['ADMIN', 'LIBRARIAN']), isActive: z.boolean() });
let stage = 'connection';

async function checkAuth(tx: Prisma.TransactionClient) {
  const email = () => `auth-${randomUUID()}@example.invalid`;
  const password = `Temporary ${randomUUID()}!`;
  const replacement = `Replacement ${randomUUID()}!`;
  const repository = new PrismaAuthRepository(tx, async (operation) => {
    await tx.$executeRaw`SAVEPOINT staff_check`;
    try {
      const result = await operation(tx);
      await tx.$executeRaw`RELEASE SAVEPOINT staff_check`;
      return result;
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT staff_check`;
      await tx.$executeRaw`RELEASE SAVEPOINT staff_check`;
      throw error;
    }
  });
  let now = Date.now();
  const activeCount = await tx.staffUser.count({ where: { isActive: true, role: 'ADMIN' } });
  let admin;
  if (activeCount === 0) admin = await new StaffService(repository).bootstrap(email(), password);
  else {
    admin = await tx.staffUser.create({ data: { email: email(), role: 'ADMIN', passwordHash: await hashPassword(password) } });
  }

  stage = 'cross-connection staff lock';
  // A different connection cannot obtain the transaction-scoped lock while an auth write holds it.
  await repository.transaction(async () => {
    const [result] = await prisma.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(17291, 1) AS acquired`;
    assert.equal(result?.acquired, false, 'Concurrent connection unexpectedly obtained the staff lock');
  });
  await assert.rejects(new StaffService(repository).bootstrap(email(), password), { code: 'ADMIN_ALREADY_EXISTS' });

  const server = createApp({ CORS_ORIGIN: origin, SESSION_TTL_SECONDS: 60 }, {
    authRepository: repository, now: () => new Date(now),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const send = async (path: string, status: number, method = 'GET', body?: object, cookie?: string) => {
      const response = await fetch(base + path, { method, headers: staffRequestHeaders(origin, cookie), ...(body && { body: JSON.stringify(body) }) });
      assert.equal(response.status, status, `${method} ${path}`);
      return response;
    };
    async function signIn(username: string, pass = password) {
      const response = await send('/auth/login', 200, 'POST', { email: username, password: pass });
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      await response.arrayBuffer();
      return cookie;
    }

    stage = 'login, expiry and persisted digest';
    let adminCookie = await signIn(admin.email.toUpperCase());
    const persisted = await tx.staffSession.findMany({ where: { staffUserId: admin.id } });
    assert.equal(persisted.length, 1);
    assert.ok(persisted[0]?.tokenHash === sessionHash(adminCookie.split('=')[1]!), 'PostgreSQL must persist the digest');
    assert.equal(persisted[0]?.expiresAt.getTime(), now + 60_000);
    await send('/auth/me', 200, 'GET', undefined, adminCookie);
    now += 60_000;
    await send('/auth/me', 401, 'GET', undefined, adminCookie);
    adminCookie = await signIn(admin.email);
    assert.equal(await tx.staffSession.count({ where: { staffUserId: admin.id } }), 1);

    stage = 'staff creation, conflicts and revocation';
    const input = { email: email(), role: 'LIBRARIAN', password };
    const account = accountJson.parse(await (await send('/staff', 201, 'POST', input, adminCookie)).json());
    await send('/staff', 409, 'POST', { ...input, email: input.email.toUpperCase() }, adminCookie);
    const librarianCookie = await signIn(account.email);
    await send('/staff', 403, 'GET', undefined, librarianCookie);
    await send('/staff/' + account.id, 200, 'PATCH', { role: 'ADMIN' }, adminCookie);
    await send('/auth/me', 401, 'GET', undefined, librarianCookie);
    const promoted = await signIn(account.email);
    await send('/staff/' + account.id + '/reset-password', 204, 'POST', { password: replacement }, adminCookie);
    await send('/auth/me', 401, 'GET', undefined, promoted);
    const reset = await signIn(account.email, replacement);

    const audit = await tx.auditLog.create({ data: { actorId: account.id, action: 'AUTH_CHECK', entityType: 'StaffUser', entityId: account.id } });
    await send('/staff/' + account.id, 200, 'PATCH', { isActive: false }, adminCookie);
    assert.equal(await tx.auditLog.count({ where: { id: audit.id, actorId: account.id } }), 1);
    await send('/auth/me', 401, 'GET', undefined, reset);
    await send('/auth/login', 401, 'POST', { email: account.email, password: replacement });
    if (activeCount === 0) await send('/staff/' + admin.id, 409, 'PATCH', { isActive: false }, adminCookie);

    stage = 'password change and idempotent logout';
    await send('/auth/change-password', 204, 'POST', { oldPassword: password, newPassword: replacement }, adminCookie);
    await send('/auth/me', 401, 'GET', undefined, adminCookie);
    adminCookie = await signIn(admin.email, replacement);
    await send('/auth/logout', 204, 'POST', undefined, adminCookie);
    await send('/auth/logout', 204, 'POST', undefined, adminCookie);
    await send('/auth/me', 401, 'GET', undefined, adminCookie);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

try {
  assertLocalSeedTarget();
  const [identity] = await prisma.$queryRaw<Array<{ db: string; username: string; schema: string }>>`
    SELECT current_database() AS db, current_user AS username, current_schema() AS schema
  `;
  assert.deepEqual(identity, { db: 'library_db', username: 'library_user', schema: 'public' });
  const original = await databaseSnapshot(prisma);
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      await checkAuth(tx);
      throw rollback;
    }, { timeout: 30_000 }), (error) => error === rollback);
  } finally {
    assert.ok(await databaseSnapshot(prisma) === original, 'Rollback must preserve all ten tables');
  }
  console.info('Auth and Staff API, PostgreSQL session digests and advisory locking verified. All ten tables match their pre-test snapshots.');
} catch {
  console.error(`Authentication database verification failed during ${stage}.`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
