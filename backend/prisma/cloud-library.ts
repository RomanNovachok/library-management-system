import type { Prisma } from '../src/generated/prisma/client.js';
import { readDatabaseUrl } from '../src/config/database-url.js';
import { lockStaffWrites } from '../src/modules/auth/auth.repository.js';
import { readerCategoryNameExists } from '../src/modules/settings/settings.repository.js';
import { assertAppliedMigrations, damageRules, demoBooks, readerCategories, SeedSafetyError } from './seed-library.js';

export function cloudTarget(environment: NodeJS.ProcessEnv = process.env) {
  const url = readDatabaseUrl({ ...environment, NODE_ENV: 'production' });
  const hostname = url.hostname;
  const database = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  if (!/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/.test(hostname)
    || hostname.split('.')[0]!.endsWith('-pooler')
    || (url.port !== '' && url.port !== '5432')
    || !/^[a-zA-Z0-9_-]+$/.test(database) || !/^[a-zA-Z0-9_-]+$/.test(username) || !url.password
    || [...url.searchParams].some(([key, value]) => !(
      (key === 'sslmode' && value === 'verify-full')
      || (key === 'schema' && value === 'public')
      || (key === 'channel_binding' && value === 'require')
    ))
    || new Set(url.searchParams.keys()).size !== url.searchParams.size
  ) {
    throw new SeedSafetyError('Initialization requires a direct Neon PostgreSQL URL with verified TLS and the public schema.');
  }
  return { database, username, endpoint: `${hostname}/${database}` };
}

type DatabaseIdentity = Pick<ReturnType<typeof cloudTarget>, 'database' | 'username'>;

export async function checkCloudDatabase(tx: Prisma.TransactionClient, target: DatabaseIdentity) {
  const [identity] = await tx.$queryRaw<Array<{ database: string; username: string; schema: string; version: number }>>`
    SELECT current_database() AS database, current_user AS username, current_schema() AS schema,
      current_setting('server_version_num')::int AS version
  `;
  if (identity?.database !== target.database || identity.username !== target.username || identity.schema !== 'public'
    || Math.trunc(identity.version / 10_000) !== 18) {
    throw new SeedSafetyError('Initialization stopped: expected PostgreSQL 18, the selected database and role, and the public schema.');
  }
  await assertAppliedMigrations(tx);
}

export async function initializeCloudLibrary(tx: Prisma.TransactionClient, target: DatabaseIdentity, includeDemoCatalog: boolean) {
  await checkCloudDatabase(tx, target);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('library_management_initial_seed'))`;
  await lockStaffWrites(tx);

  // Stable IDs let later runs recognize seed records whose editable fields changed.
  for (const [index, data] of readerCategories.entries()) {
    const id = `7ffabc47-48a2-423d-ad8f-2afdc140100${index + 1}`;
    if (await tx.readerCategory.findUnique({ where: { id }, select: { id: true } })) continue;
    if (await readerCategoryNameExists(tx, data.name)) {
      throw new SeedSafetyError('A starting category already exists with a different ID. No changes committed.');
    }
    await tx.readerCategory.create({ data: { id, ...data } });
  }
  for (const data of damageRules) {
    await tx.damageRule.createMany({ data, skipDuplicates: true });
  }
  if (!includeDemoCatalog) return;

  for (const { inventoryCodes, ...data } of demoBooks) {
    await tx.book.createMany({ data, skipDuplicates: true });
    for (const inventoryCode of inventoryCodes) {
      const id = `7ffabc47-48a2-423d-ad8f-2afdc140${inventoryCode.slice(-4)}`;
      if (await tx.bookCopy.findUnique({ where: { id }, select: { id: true } })) continue;
      if (await tx.bookCopy.findUnique({ where: { inventoryCode }, select: { id: true } })) {
        throw new SeedSafetyError('A demo inventory code is already in use. No changes committed.');
      }
      await tx.bookCopy.create({ data: { id, bookId: data.id, inventoryCode } });
    }
  }
}
