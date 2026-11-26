import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { assertLocalSeedTarget } from '../prisma/seed-library.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { databaseSnapshot } from './database-snapshot.js';

export async function withIsolatedDatabase(name: 'settings' | 'rentals' | 'reports', check: (db: PrismaClient, sql: Client, schema: string) => Promise<void>) {
  assertLocalSeedTarget();
  const connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString });
  const schema = `${name}_check_${randomUUID().replaceAll('-', '')}`;
  const live = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: 'public' }) });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}`, application_name: schema }, { schema }) });
  await sql.connect();
  let before: string | undefined;
  let created = false;
  try {
    const { rows: [identity] } = await sql.query('SELECT current_database() AS database, current_user AS username');
    assert.deepEqual(identity, { database: 'library_db', username: 'library_user' });
    before = await databaseSnapshot(live);
    await sql.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await sql.query(`SET search_path TO "${schema}"`);
    const migrations = new URL('../prisma/migrations/', import.meta.url);
    const entries = (await readdir(migrations, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const { name: migrationName } of entries) {
      const migration = await readFile(new URL(`${migrationName}/migration.sql`, migrations), 'utf8');
      await sql.query(migration.replace('CREATE SCHEMA IF NOT EXISTS "public";', ''));
    }
    const [target] = await db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`;
    assert.equal(target?.schema, schema);
    await check(db, sql, schema);
  } finally {
    try {
      await db.$disconnect();
      if (created) {
        await sql.query('ROLLBACK');
        await sql.query(`DROP SCHEMA "${schema}" CASCADE`);
        assert.equal((await sql.query('SELECT to_regnamespace($1) AS name', [schema])).rows[0]?.name, null);
      }
      if (before !== undefined) {
        assert.equal(await databaseSnapshot(live) === before, true, 'Operational table contents changed during the check');
        console.info('Temporary schema removed. Verified unchanged rows in all ten application tables in public.');
      }
    } finally {
      await live.$disconnect();
      await sql.end();
    }
  }
}
