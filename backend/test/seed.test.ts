import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLocalSeedTarget, demoBooks } from '../prisma/seed-library.js';

const localUrl = 'postgresql://library_user:test%40password@127.0.0.1:5433/library_db?schema=public';

test('seed accepts only the expected local training target', () => {
  assert.doesNotThrow(() => assertLocalSeedTarget({ DATABASE_URL: localUrl, NODE_ENV: 'development' }));
  assert.doesNotThrow(() => assertLocalSeedTarget({ DATABASE_URL: localUrl.replace('127.0.0.1', 'localhost') }));
  assert.doesNotThrow(() => assertLocalSeedTarget({ DATABASE_URL: localUrl.replace('?schema=public', '') }));
});

test('seed rejects production, remote targets, wrong identities and connection overrides', () => {
  assert.throws(() => assertLocalSeedTarget({ DATABASE_URL: localUrl, NODE_ENV: 'production' }), /production/);
  for (const value of [
    undefined, '', 'invalid',
    localUrl.replace('127.0.0.1', 'production.example.com'),
    localUrl.replace('5433', '5432'),
    localUrl.replace('library_db', 'other_database'),
    localUrl.replace('library_user', 'other_user'),
    localUrl.replace('test%40password', ''),
    localUrl.replace('schema=public', 'schema=private'),
    `${localUrl}&host=production.example.com`,
    `${localUrl}&schema=public`,
    `${localUrl}#fragment`,
  ]) {
    const environment: NodeJS.ProcessEnv = {};
    if (value !== undefined) environment.DATABASE_URL = value;
    assert.throws(() => assertLocalSeedTarget(environment));
  }
});

test('demo editions have stable distinct UUIDs and unique inventory codes', () => {
  assert.equal(demoBooks.length, 5);
  assert.equal(new Set(demoBooks.map((book) => book.id)).size, 5);
  const codes = demoBooks.flatMap((book) => [...book.inventoryCodes]);
  assert.equal(codes.length, 12);
  assert.equal(new Set(codes).size, 12);
  for (const book of demoBooks) {
    assert.match(book.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(book.inventoryCodes.length >= 2 && book.inventoryCodes.length <= 3);
    assert.ok(book.dailyPrice.isPositive() && book.depositAmount.isPositive());
  }
  for (const code of codes) assert.match(code, /^INV-\d{4}$/);
});
