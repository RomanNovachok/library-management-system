import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/error-handler.js';

const origin = 'https://frontend.example.com';
const server = createServer(createApp({ CORS_ORIGIN: origin }));
let baseUrl: string;

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('GET /api/health returns HTTP 200 and JSON status', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('unknown routes return a JSON 404', async () => {
  const response = await fetch(`${baseUrl}/api/unknown`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
});

test('malformed JSON returns a JSON 400', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
  });
});

test('oversized JSON returns a JSON 413', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(110_000) }),
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
  });
});

test('CORS allows the configured origin', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: origin },
  });

  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  await response.arrayBuffer();
});

test('CORS omits the allow-origin header for other origins', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://other.example.com' },
  });

  assert.equal(response.headers.get('access-control-allow-origin'), null);
  await response.arrayBuffer();
});

test('CORS handles preflight for the configured origin', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.match(response.headers.get('access-control-allow-methods') ?? '', /GET/);
  assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type');
});

test('unexpected errors return a JSON 500 without internal details', async (t) => {
  const app = express();
  app.get('/error', () => { throw new Error('private internal details'); });
  app.use(errorHandler);
  const errorServer = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      errorServer.close((error) => error ? reject(error) : resolve());
    });
  });
  const log = t.mock.method(console, 'error', () => {});
  await once(errorServer, 'listening');

  const port = (errorServer.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/error`);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
  });
  assert.equal(log.mock.callCount(), 1);
});
