import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Vercel sends only API routes to the configured Render service and protects the SPA fallback', async () => {
  process.env.RENDER_API_ORIGIN = 'https://library-fixture.onrender.com';
  const { config } = await import('../vercel.ts');
  delete process.env.RENDER_API_ORIGIN;
  const [proxy, fallback] = config.rewrites;
  assert.deepEqual(proxy, { source: '/api/:path*', destination: 'https://library-fixture.onrender.com/api/:path*' });
  const spaRoute = new RegExp(`^${fallback.source}$`);
  for (const path of ['/api', '/api/auth/login', '/API/health', '/assets/index.js']) assert.doesNotMatch(path, spaRoute);
  for (const path of ['/', '/login', '/books/reader-id', '/reports', '/unknown']) assert.match(path, spaRoute);
  assert.equal(fallback.destination, '/index.html');
});

test('Vercel rejects a missing production target and non-Render targets', async () => {
  process.env.VERCEL_ENV = 'production';
  try {
    await assert.rejects(import('../vercel.ts?missing'), /Set RENDER_API_ORIGIN/);
    process.env.RENDER_API_ORIGIN = 'https://library-fixture.onrender.com.example.test';
    await assert.rejects(import('../vercel.ts?invalid'), /HTTPS origin of the Render service/);
  } finally {
    delete process.env.VERCEL_ENV;
    delete process.env.RENDER_API_ORIGIN;
  }
});
