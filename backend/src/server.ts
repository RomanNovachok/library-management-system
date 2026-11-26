import 'dotenv/config';
import { createApp } from './app.js';
import { readEnv } from './config/env.js';
import { prisma } from './lib/prisma.js';

const env = readEnv();
const app = createApp(env);

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.info(`Library API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

server.on('error', () => {
  console.error('Failed to start Library API. Check PORT and whether it is in use.');
  process.exitCode = 1;
});

function shutdown() {
  // Leave enough time for requests to finish and keep shutdown bounded.
  const deadline = setTimeout(() => process.exit(1), 25_000);
  deadline.unref();
  server.close((error) => {
    if (error) process.exitCode = 1;
    void prisma.$disconnect().catch(() => {
      console.error('Failed to close the database pool.');
      process.exitCode = 1;
    }).finally(() => clearTimeout(deadline));
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
