import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { CopyStatus, DamageOutcome, Prisma } from '../src/generated/prisma/client.js';
import { lockStaffWrites } from '../src/modules/auth/auth.repository.js';
import { readerCategoryNameExists } from '../src/modules/settings/settings.repository.js';

export class SeedSafetyError extends Error {}

export function assertLocalSeedTarget(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NODE_ENV === 'production') {
    throw new SeedSafetyError('Seed is disabled when NODE_ENV=production.');
  }

  let url: URL;
  try {
    url = new URL(environment.DATABASE_URL ?? '');
  } catch {
    throw new SeedSafetyError('Seed requires a valid local PostgreSQL DATABASE_URL.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.port !== '5433'
    || url.pathname !== '/library_db'
    || url.username !== 'library_user'
    || !url.password
    || url.hash
    || [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')
    || url.searchParams.getAll('schema').length > 1
  ) {
    throw new SeedSafetyError('Seed is restricted to library_user on local library_db:5433, public schema.');
  }
}

export const readerCategories = [
  { name: 'Стандартна', discountPercent: new Prisma.Decimal('0.00') },
  { name: 'Студент', discountPercent: new Prisma.Decimal('10.00') },
  { name: 'Пенсіонер', discountPercent: new Prisma.Decimal('20.00') },
] as const;

export const damageRules = [
  { code: 'NONE', label: 'Без пошкоджень', penaltyPercent: new Prisma.Decimal('0.00'), outcome: DamageOutcome.AVAILABLE },
  { code: 'MINOR', label: 'Незначне пошкодження', penaltyPercent: new Prisma.Decimal('10.00'), outcome: DamageOutcome.AVAILABLE },
  { code: 'MAJOR', label: 'Серйозне пошкодження', penaltyPercent: new Prisma.Decimal('50.00'), outcome: DamageOutcome.MAINTENANCE },
  { code: 'LOST', label: 'Втрачено книгу', penaltyPercent: new Prisma.Decimal('100.00'), outcome: DamageOutcome.LOST },
] as const;

// These IDs identify demo editions even after a librarian changes a title or tariff.
export const demoBooks = [
  {
    id: 'c7c0e4b4-87c4-4c6a-a841-18fdbed10001',
    title: 'Тіні забутих предків', author: 'Михайло Коцюбинський', genre: 'Повість',
    dailyPrice: new Prisma.Decimal('4.00'), depositAmount: new Prisma.Decimal('250.00'),
    inventoryCodes: ['INV-0001', 'INV-0002'],
  },
  {
    id: 'c7c0e4b4-87c4-4c6a-a841-18fdbed10002',
    title: 'Лісова пісня', author: 'Леся Українка', genre: 'Драма-феєрія',
    dailyPrice: new Prisma.Decimal('5.00'), depositAmount: new Prisma.Decimal('300.00'),
    inventoryCodes: ['INV-0003', 'INV-0004', 'INV-0005'],
  },
  {
    id: 'c7c0e4b4-87c4-4c6a-a841-18fdbed10003',
    title: 'Місто', author: "Валер'ян Підмогильний", genre: 'Роман',
    dailyPrice: new Prisma.Decimal('6.00'), depositAmount: new Prisma.Decimal('350.00'),
    inventoryCodes: ['INV-0006', 'INV-0007'],
  },
  {
    id: 'c7c0e4b4-87c4-4c6a-a841-18fdbed10004',
    title: 'Захар Беркут', author: 'Іван Франко', genre: 'Історична повість',
    dailyPrice: new Prisma.Decimal('4.50'), depositAmount: new Prisma.Decimal('280.00'),
    inventoryCodes: ['INV-0008', 'INV-0009', 'INV-0010'],
  },
  {
    id: 'c7c0e4b4-87c4-4c6a-a841-18fdbed10005',
    title: 'Тигролови', author: 'Іван Багряний', genre: 'Пригодницький роман',
    dailyPrice: new Prisma.Decimal('7.00'), depositAmount: new Prisma.Decimal('400.00'),
    inventoryCodes: ['INV-0011', 'INV-0012'],
  },
] as const;

export async function assertAppliedMigrations(tx: Prisma.TransactionClient): Promise<void> {
  const directory = new URL('./migrations/', import.meta.url);
  const expected = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const history = await tx.$queryRaw<Array<{
    migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null;
  }>>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  const completed = history.filter((row) => row.finished_at !== null && row.rolled_back_at === null);
  if (
    expected.length === 0
    || history.some((row) => row.finished_at === null && row.rolled_back_at === null)
    || completed.length !== expected.length
    || completed.some((row) => !expected.includes(row.migration_name))
  ) {
    throw new SeedSafetyError('Initialization requires all repository migrations to be successfully applied. Check prisma:migrate:status.');
  }
  for (const name of expected) {
    const script = await readFile(new URL(`${name}/migration.sql`, directory), 'utf8');
    // Git checkouts may change line endings; accept equivalent LF/CRLF scripts.
    const lf = script.replace(/\r\n/g, '\n');
    const checksums = new Set([script, lf, lf.replace(/\n/g, '\r\n')]
      .map((text) => createHash('sha256').update(text).digest('hex')));
    if (!completed.some((row) => row.migration_name === name && checksums.has(row.checksum))) {
      throw new SeedSafetyError('Seed stopped: migration files do not match the applied history.');
    }
  }
}

export async function seedLibrary(tx: Prisma.TransactionClient) {
  const [identity] = await tx.$queryRaw<Array<{ database: string; username: string; schema: string }>>`
    SELECT current_database() AS database, current_user AS username, current_schema() AS schema
  `;
  if (identity?.database !== 'library_db' || identity.username !== 'library_user' || identity.schema !== 'public') {
    throw new SeedSafetyError('Seed stopped: database identity does not match the local training configuration.');
  }

  await assertAppliedMigrations(tx);

  // Serialize seed transactions; the lock is released automatically on commit/rollback.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('library_management_initial_seed'))`;

  // Use the same name comparison and lock as administrative category writes.
  await lockStaffWrites(tx);
  for (const data of readerCategories) {
    if (!await readerCategoryNameExists(tx, data.name)) await tx.readerCategory.create({ data });
  }
  for (const data of damageRules) {
    await tx.damageRule.upsert({ where: { code: data.code }, create: data, update: {} });
  }
  for (const { inventoryCodes, ...data } of demoBooks) {
    await tx.book.upsert({ where: { id: data.id }, create: data, update: {} });
    for (const inventoryCode of inventoryCodes) {
      const copy = await tx.bookCopy.upsert({
        where: { inventoryCode },
        create: { bookId: data.id, inventoryCode, status: CopyStatus.AVAILABLE },
        update: {},
      });
      if (copy.bookId !== data.id) {
        throw new SeedSafetyError(`Seed stopped: ${inventoryCode} belongs to another book. No changes committed.`);
      }
    }
  }

  return {
    readerCategories: readerCategories.length,
    damageRules: damageRules.length,
    books: demoBooks.length,
    bookCopies: demoBooks.reduce((count, book) => count + book.inventoryCodes.length, 0),
  };
}
