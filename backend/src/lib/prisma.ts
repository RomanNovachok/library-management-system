import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { readDatabaseUrl } from '../config/database-url.js';

const database = readDatabaseUrl();
const adapter = new PrismaPg({
  connectionString: database.href,
  connectionTimeoutMillis: 5000,
  enableChannelBinding: database.searchParams.get('channel_binding') === 'require',
});

// ESM caches this module, so all consumers share one client and connection pool.
export const prisma = new PrismaClient({ adapter });
