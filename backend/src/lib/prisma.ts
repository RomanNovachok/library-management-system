import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

const connectionString = process.env.DATABASE_URL;

if (!connectionString?.trim()) {
  throw new Error('DATABASE_URL is required to initialize Prisma Client.');
}

const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 });

// ESM caches this module, so all consumers share one client and connection pool.
export const prisma = new PrismaClient({ adapter });
