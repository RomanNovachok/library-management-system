import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const tables = ['StaffUser', 'ReaderCategory', 'Reader', 'Book', 'BookCopy', 'Rental', 'DamageRule', 'CashMovement', 'AuditLog'] as const;
type Table = typeof tables[number];
const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, 'DATABASE_URL is required.');
const url = new URL(connectionString);
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Expected a PostgreSQL URL.');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'STOP: only the local training database is allowed.');
assert.equal(url.port, '5433', 'STOP: expected local port 5433.');
assert.equal(url.pathname, '/library_db', 'STOP: expected library_db.');
assert.ok([null, 'public'].includes(url.searchParams.get('schema')), 'STOP: expected the public schema.');

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
let inTransaction = false;
let cases = 0;

async function insert(table: Table, values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values);
  const result = await client.query<{ id: string }>(
    `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING id`,
    Object.values(values),
  );
  const id = result.rows[0]?.id;
  assert.ok(id);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  return id;
}

async function expectError(action: () => Promise<unknown>, code: string | readonly string[], constraint?: string) {
  await client.query('SAVEPOINT schema_check_case');
  let failure: unknown;
  try { await action(); } catch (error) { failure = error; }
  finally {
    await client.query('ROLLBACK TO SAVEPOINT schema_check_case');
    await client.query('RELEASE SAVEPOINT schema_check_case');
  }
  assert.ok(failure instanceof pg.DatabaseError, `Expected PostgreSQL error ${code} (${constraint ?? 'constraint'}).`);
  const allowedCodes = typeof code === 'string' ? [code] : code;
  assert.ok(allowedCodes.includes(failure.code ?? ''), `Expected ${allowedCodes.join('/')} for ${constraint ?? 'constraint'}, received ${failure.code}.`);
  if (constraint) assert.equal(failure.constraint, constraint);
  cases++;
}

async function expectSuccess(action: () => Promise<unknown>) {
  await client.query('SAVEPOINT schema_check_case');
  try { await action(); }
  finally {
    await client.query('ROLLBACK TO SAVEPOINT schema_check_case');
    await client.query('RELEASE SAVEPOINT schema_check_case');
  }
  cases++;
}

async function rowCounts() {
  const counts: Record<string, string> = {};
  for (const table of tables) {
    const result = await client.query<{ count: string }>(`SELECT count(*) FROM "${table}"`);
    counts[table] = result.rows[0]!.count;
  }
  return counts;
}

async function verifySchema() {
  const existingTables = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
  assert.deepEqual(existingTables.rows.map((row) => row.table_name).sort(), [...tables, '_prisma_migrations'].sort());

  const foreignKeys = await client.query<{ name: string; deletion: string; validated: boolean }>("SELECT conname AS name, confdeltype AS deletion, convalidated AS validated FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace");
  const expectedForeignKeys = ['Reader_categoryId_fkey', 'BookCopy_bookId_fkey', 'Rental_readerId_fkey', 'Rental_copyId_fkey', 'Rental_issuedById_fkey', 'Rental_closedById_fkey', 'Rental_damageRuleId_fkey', 'CashMovement_rentalId_fkey', 'CashMovement_recordedById_fkey', 'AuditLog_actorId_fkey'];
  assert.deepEqual(foreignKeys.rows.map((row) => row.name).sort(), expectedForeignKeys.sort());
  for (const key of foreignKeys.rows) { assert.equal(key.deletion, 'r'); assert.equal(key.validated, true); }

  const columns = await client.query<{ table_name: string; column_name: string; udt_name: string; column_default: string | null; numeric_precision: number | null; numeric_scale: number | null; datetime_precision: number | null }>("SELECT table_name, column_name, udt_name, column_default, numeric_precision, numeric_scale, datetime_precision FROM information_schema.columns WHERE table_schema='public' AND table_name <> '_prisma_migrations'");
  for (const column of columns.rows) {
    if (column.column_name === 'id' || column.column_name.endsWith('Id')) {
      assert.equal(column.udt_name, 'uuid');
      if (column.column_name === 'id') assert.match(column.column_default ?? '', /gen_random_uuid/);
    }
    if (column.udt_name === 'numeric') {
      assert.equal(column.numeric_scale, 2);
      assert.equal(column.numeric_precision, column.column_name.includes('Percent') ? 5 : 12);
    }
    if (column.column_name.endsWith('At')) {
      assert.equal(column.udt_name, 'timestamptz');
      assert.equal(column.datetime_precision, 3);
    }
  }
  assert.equal(columns.rows.filter((column) => column.udt_name === 'numeric').length, 13);
  assert.equal(columns.rows.find((column) => column.table_name === 'AuditLog' && column.column_name === 'details')?.udt_name, 'jsonb');

  const enums = await client.query<{ name: string; labels: string[] }>("SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' GROUP BY t.typname");
  assert.deepEqual(Object.fromEntries(enums.rows.map((row) => [row.name, row.labels])), {
    StaffRole: ['ADMIN', 'LIBRARIAN'], CopyStatus: ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST'],
    DamageOutcome: ['AVAILABLE', 'MAINTENANCE', 'LOST'], RentalStatus: ['ACTIVE', 'RETURNED', 'LOST'],
    CashMovementType: ['DEPOSIT_IN', 'REFUND_OUT', 'TOPUP_IN'],
  });
  const partialIndex = await client.query<{ indisunique: boolean; predicate: string; definition: string }>("SELECT indisunique, pg_get_expr(indpred, indrelid) AS predicate, pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indexrelid='\"Rental_one_active_copy_key\"'::regclass");
  assert.equal(partialIndex.rows[0]?.indisunique, true);
  assert.match(partialIndex.rows[0]?.predicate ?? '', /status.*ACTIVE/);
  assert.match(partialIndex.rows[0]?.definition ?? '', /\("copyId"\)/);
  const checks = await client.query<{ convalidated: boolean }>("SELECT convalidated FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace");
  assert.equal(checks.rowCount, 16);
  assert.ok(checks.rows.every((row) => row.convalidated));
  console.info('Catalog verified: 9 models, 10 RESTRICT foreign keys, 5 enums, UUID/Decimal/timestamptz/jsonb types, partial unique index and 16 CHECK constraints.');
}

async function verifyConstraints() {
  // Every fixture exists only inside this transaction. This is not a seed script.
  const suffix = randomUUID();
  const staffValues = { email: `schema-${suffix}@example.invalid`, passwordHash: 'schema-test-only', role: 'LIBRARIAN' };
  const staff = await insert('StaffUser', staffValues);
  const categoryValues = { name: `schema-${suffix}`, discountPercent: '0.00' };
  const category = await insert('ReaderCategory', categoryValues);
  const reader = await insert('Reader', { fullName: 'Rolled back schema check', address: 'Transaction only', phone: 'test-only', categoryId: category });
  const book = await insert('Book', { title: 'Schema check', author: 'Transaction only', genre: 'Test', dailyPrice: '10.00', depositAmount: '100.00' });
  const copyValues = { bookId: book, inventoryCode: `schema-${suffix}`, status: 'RENTED' };
  const copy = await insert('BookCopy', copyValues);
  const historyCopy = await insert('BookCopy', { bookId: book, inventoryCode: `history-${suffix}`, status: 'AVAILABLE' });
  const damageValues = { code: `schema-${suffix}`, label: 'Schema check', penaltyPercent: '0.00', outcome: 'AVAILABLE' };
  const damage = await insert('DamageRule', damageValues);
  const rentalValues = { readerId: reader, copyId: copy, issuedById: staff, issuedAt: '2026-01-01T12:00:00.000Z', dueAt: '2026-01-03T12:00:00.000Z', pricePerDaySnapshot: '10.00', depositSnapshot: '100.00', discountPercentSnapshot: '0.00', readerCategorySnapshot: categoryValues.name };
  const rental = await insert('Rental', rentalValues);
  const closedValues = { ...rentalValues, copyId: historyCopy, status: 'RETURNED', closedAt: '2026-01-02T12:00:00.000Z', closedById: staff, rentalFee: '10.00', damageFine: '0.00', damagePercentSnapshot: '0.00', refundAmount: '90.00', additionalPayment: '0.00', damageRuleId: damage };
  const closed = await insert('Rental', closedValues);
  const movement = await insert('CashMovement', { rentalId: rental, type: 'DEPOSIT_IN', amount: '100.00', recordedById: staff });
  const audit = await insert('AuditLog', { actorId: staff, action: 'RENTAL_ISSUED', entityType: 'Rental', entityId: rental, details: { schemaCheck: true } });
  const update = (table: Table, column: string, id: string, value: unknown) => client.query(`UPDATE "${table}" SET "${column}"=$1 WHERE id=$2`, [value, id]);

  const money: [Table, string, string][] = [
    ['Book', 'dailyPrice', book], ['Book', 'depositAmount', book],
    ['Rental', 'pricePerDaySnapshot', rental], ['Rental', 'depositSnapshot', rental],
    ['Rental', 'rentalFee', closed], ['Rental', 'damageFine', closed],
    ['Rental', 'refundAmount', closed], ['Rental', 'additionalPayment', closed], ['CashMovement', 'amount', movement],
  ];
  for (const [table, column, id] of money) {
    for (const value of ['-0.01', 'NaN']) await expectError(() => update(table, column, id, value), '23514', `${table}_${column}_check`);
    await expectSuccess(() => update(table, column, id, '0.00'));
  }
  const percentages: [Table, string, string][] = [
    ['ReaderCategory', 'discountPercent', category], ['DamageRule', 'penaltyPercent', damage],
    ['Rental', 'discountPercentSnapshot', rental], ['Rental', 'damagePercentSnapshot', closed],
  ];
  for (const [table, column, id] of percentages) {
    for (const value of ['-0.01', '100.01', 'NaN']) await expectError(() => update(table, column, id, value), '23514', `${table}_${column}_check`);
    for (const value of ['0.00', '100.00']) await expectSuccess(() => update(table, column, id, value));
  }
  await expectError(() => insert('StaffUser', staffValues), '23505', 'StaffUser_email_key');
  await expectError(() => insert('ReaderCategory', categoryValues), '23505', 'ReaderCategory_name_key');
  await expectError(() => insert('BookCopy', copyValues), '23505', 'BookCopy_inventoryCode_key');
  await expectError(() => insert('DamageRule', damageValues), '23505', 'DamageRule_code_key');
  await expectError(() => insert('Rental', rentalValues), '23505', 'Rental_one_active_copy_key');
  // Closed history does not reserve a copy: another closed rental and a new active one are allowed.
  await expectSuccess(() => insert('Rental', closedValues));
  await expectSuccess(() => insert('Rental', { ...rentalValues, copyId: historyCopy }));
  await expectError(() => update('Rental', 'dueAt', rental, rentalValues.issuedAt), '23514', 'Rental_dueAt_check');
  await expectError(() => update('Rental', 'dueAt', rental, '2025-12-31T12:00:00.000Z'), '23514', 'Rental_dueAt_check');
  await expectError(() => update('Rental', 'closedAt', closed, '2025-12-31T12:00:00.000Z'), '23514', 'Rental_closedAt_check');
  await expectError(() => update('Rental', 'status', rental, 'RETURNED'), '23514', 'Rental_closure_check');
  await expectError(() => update('Rental', 'closedById', closed, null), '23514', 'Rental_closure_check');
  await expectError(() => update('Rental', 'rentalFee', closed, null), '23514', 'Rental_closure_check');
  await expectError(() => update('BookCopy', 'status', copy, 'UNKNOWN'), '22P02');

  const foreignKeys: [Table, string, string][] = [
    ['Reader', 'categoryId', reader], ['BookCopy', 'bookId', copy], ['Rental', 'readerId', rental],
    ['Rental', 'copyId', rental], ['Rental', 'issuedById', rental], ['Rental', 'closedById', closed],
    ['Rental', 'damageRuleId', closed], ['CashMovement', 'rentalId', movement],
    ['CashMovement', 'recordedById', movement], ['AuditLog', 'actorId', audit],
  ];
  for (const [table, column, id] of foreignKeys) {
    await expectError(() => update(table, column, id, randomUUID()), '23503', `${table}_${column}_fkey`);
  }
  for (const [table, id] of [['ReaderCategory', category], ['Book', book], ['BookCopy', copy], ['Reader', reader], ['StaffUser', staff], ['DamageRule', damage], ['Rental', rental]] as const) {
    await expectError(() => client.query(`DELETE FROM "${table}" WHERE id=$1`, [id]), ['23001', '23503']);
  }
  // Audit entityId is deliberately polymorphic, not a foreign key.
  await expectSuccess(() => update('AuditLog', 'entityId', audit, randomUUID()));
  const snapshots = await client.query('SELECT "readerCategorySnapshot", "discountPercentSnapshot"::text FROM "Rental" WHERE id=$1', [rental]);
  await client.query('UPDATE "ReaderCategory" SET name=$1, "discountPercent"=100 WHERE id=$2', [`changed-${suffix}`, category]);
  assert.deepEqual((await client.query('SELECT "readerCategorySnapshot", "discountPercentSnapshot"::text FROM "Rental" WHERE id=$1', [rental])).rows, snapshots.rows);
  const damageSnapshot = await client.query('SELECT "damagePercentSnapshot"::text FROM "Rental" WHERE id=$1', [closed]);
  await client.query('UPDATE "DamageRule" SET "penaltyPercent"=100 WHERE id=$1', [damage]);
  assert.deepEqual((await client.query('SELECT "damagePercentSnapshot"::text FROM "Rental" WHERE id=$1', [closed])).rows, damageSnapshot.rows);
  cases += 2;
}

try {
  await client.connect();
  const identity = await client.query('SELECT current_database() AS db, current_user AS username');
  assert.deepEqual(identity.rows, [{ db: 'library_db', username: 'library_user' }]);
  if (process.argv.includes('--expect-empty')) {
    const objects = await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'");
    const types = await client.query("SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typtype IN ('e','d','c') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'");
    const schemas = await client.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname !~ '^pg_(toast|temp)'");
    assert.equal(objects.rowCount, 0, 'STOP: existing database objects; do not apply or reset.');
    assert.equal(types.rowCount, 0, 'STOP: existing user-defined types; review before applying.');
    assert.equal(schemas.rowCount, 0, 'STOP: existing nonstandard schemas; review before applying.');
    console.info('Preflight OK: local 127.0.0.1:5433/library_db, library_user; no application objects or migration history. No writes performed.');
  } else {
    const before = await rowCounts();
    await client.query('BEGIN');
    inTransaction = true;
    await verifySchema();
    await verifyConstraints();
    await client.query('ROLLBACK');
    inTransaction = false;
    assert.deepEqual(await rowCounts(), before, 'Row counts must be unchanged after rollback.');
    console.info(`Schema checks passed: ${cases} constraint and snapshot cases; transaction rolled back, row counts unchanged.`);
  }
} catch (error) {
  if (error instanceof assert.AssertionError) console.error(error.message);
  else if (error instanceof pg.DatabaseError) console.error(`Schema check failed: PostgreSQL ${error.code}, constraint ${error.constraint ?? '(none)'}.`);
  else console.error('Schema check failed. Verify the local DATABASE_URL and PostgreSQL availability.');
  process.exitCode = 1;
} finally {
  if (inTransaction) await client.query('ROLLBACK');
  await client.end();
}
