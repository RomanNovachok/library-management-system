import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { readDatabaseUrl } from './src/config/database-url.js';

function migrationUrl() {
  if (!process.env.DATABASE_URL) return {};
  const url = readDatabaseUrl();
  const isNeon = url.hostname.endsWith('.neon.tech');
  if (isNeon || process.env.NODE_ENV === 'production') {
    readDatabaseUrl({ ...process.env, NODE_ENV: 'production' });
    if (url.hostname.split('.')[0]?.endsWith('-pooler') || url.searchParams.has('host') || url.searchParams.has('pgbouncer')) {
      throw new Error('Prisma CLI requires the direct PostgreSQL endpoint.');
    }
    // Prisma's migration engine uses different TLS parameters from node-postgres.
    url.searchParams.set('sslmode', 'require');
    url.searchParams.set('sslaccept', 'strict');
  }
  return { url: url.href };
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: migrationUrl(),
});
