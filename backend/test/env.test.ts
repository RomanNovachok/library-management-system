import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEnv } from '../src/config/env.js';

test('environment configuration applies defaults and parses PORT', () => {
  assert.deepEqual(readEnv({ CORS_ORIGIN: 'https://frontend.example.com' }), {
    NODE_ENV: 'development', PORT: 3000, CORS_ORIGIN: 'https://frontend.example.com',
  });
  assert.equal(readEnv({ CORS_ORIGIN: 'https://frontend.example.com', PORT: '4321' }).PORT, 4321);
});

test('environment configuration rejects invalid ports and origins', () => {
  for (const port of ['', '0', '-1', '65536', '3.5', 'abc']) {
    assert.throws(() => readEnv({ PORT: port, CORS_ORIGIN: 'https://frontend.example.com' }), /PORT/);
  }
  for (const value of [undefined, '', '*', 'null', 'ftp://example.com', 'https://example.com/path', 'https://example.com/']) {
    const environment: NodeJS.ProcessEnv = {};
    if (value !== undefined) environment.CORS_ORIGIN = value;
    assert.throws(() => readEnv(environment), /CORS_ORIGIN/);
  }
  assert.throws(() => readEnv({ NODE_ENV: 'invalid', CORS_ORIGIN: 'https://example.com' }), /NODE_ENV/);
});
