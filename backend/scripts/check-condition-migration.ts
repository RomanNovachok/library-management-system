import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { assertLocalSeedTarget } from '../prisma/seed-library.js';

const originalTables = ['Book', 'BookCopy', 'Reader', 'ReaderCategory', 'Rental', 'CashMovement', 'DamageRule', 'StaffUser', 'StaffSession', 'AuditLog'];
const addedColumns: Record<string, string[]> = {
  BookCopy: ['condition', 'conditionNotes'],
  Rental: ['conditionAtIssue', 'conditionNotesAtIssue', 'conditionAtReturn', 'conditionNotesAtReturn', 'newDamageNotes'],
};

assertLocalSeedTarget();
const client = new Client({ connectionString: process.env.DATABASE_URL! });
await client.connect();
try {
  const { rows: [target] } = await client.query('SELECT current_database() AS database, current_user AS username');
  assert.deepEqual(target, { database: 'library_db', username: 'library_user' });
  const { rows: [migration] } = await client.query<{ applied: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'BookCopy' AND column_name = 'condition') AS applied
  `);
  async function snapshot() {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const rows: { table: string; count: string; checksum: string }[] = [];
      for (const table of originalTables) {
        const { rows: [result] } = await client.query<{ count: string; checksum: string }>(`
          SELECT count(*), md5(COALESCE(string_agg((to_jsonb(t) - $1::text[])::text, E'\\n' ORDER BY to_jsonb(t) - $1::text[]), '')) AS checksum
          FROM public."${table}" AS t
        `, [addedColumns[table] ?? []]);
        rows.push({ table, ...result! });
      }
      return rows;
    } finally {
      await client.query('ROLLBACK');
    }
  }
  const before = await snapshot();
  const deploy = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'inherit' });
  assert.equal(deploy.status, 0, 'Prisma migrate deploy failed');
  assert.deepEqual(await snapshot(), before, 'Existing rows or member values changed during migration');
  if (!migration?.applied) {
    const { rows: [backfill] } = await client.query(`
      SELECT NOT EXISTS (SELECT 1 FROM public."BookCopy"
        WHERE "condition"::text <> CASE WHEN "status" = 'LOST' THEN 'LOST' ELSE 'UNKNOWN' END OR "conditionNotes" IS NOT NULL) AS "copiesOk",
        NOT EXISTS (SELECT 1 FROM public."Rental" WHERE "conditionAtIssue" IS NOT NULL OR "conditionNotesAtIssue" IS NOT NULL
          OR "conditionAtReturn" IS NOT NULL OR "conditionNotesAtReturn" IS NOT NULL OR "newDamageNotes" IS NOT NULL) AS "rentalsOk"
    `);
    assert.deepEqual(backfill, { copiesOk: true, rentalsOk: true });
  }
  console.info('Verified every original column in ten tables before and after migration.');
  console.info(before.filter(({ table }) => ['BookCopy', 'Rental', 'CashMovement'].includes(table)).map(({ table, count }) => `${table}: ${count}`).join(', '));
} finally {
  await client.end();
}
