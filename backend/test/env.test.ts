import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEnv } from '../src/config/env.js';

test('environment configuration applies defaults and parses PORT', () => {
  assert.deepEqual(readEnv({ CORS_ORIGIN: 'https://frontend.example.com' }), {
    NODE_ENV: 'development', PORT: 3000, CORS_ORIGIN: 'https://frontend.example.com',
    SESSION_TTL_SECONDS: 28800, SESSION_COOKIE_SAME_SITE: 'lax',
  });
  assert.equal(readEnv({ CORS_ORIGIN: 'https://frontend.example.com', PORT: '4321' }).PORT, 4321);
});

test('session configuration bounds expiry and requires HTTPS for production cookies', () => {
  const http = 'http://localhost:5173';
  const https = 'https://frontend.example.com';
  assert.throws(() => readEnv({ CORS_ORIGIN: http, SESSION_COOKIE_SAME_SITE: 'none' }), /SESSION_COOKIE_SAME_SITE/);
  assert.throws(() => readEnv({ CORS_ORIGIN: http, NODE_ENV: 'production' }), /CORS_ORIGIN/);
  assert.throws(() => readEnv({ CORS_ORIGIN: https, SESSION_TTL_SECONDS: '59' }), /SESSION_TTL_SECONDS/);
  assert.equal(readEnv({ CORS_ORIGIN: https, NODE_ENV: 'production', SESSION_COOKIE_SAME_SITE: 'none' }).SESSION_COOKIE_SAME_SITE, 'none');
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
