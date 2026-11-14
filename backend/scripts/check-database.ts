import { prisma } from '../src/lib/prisma.js';

try {
  const rows = await prisma.$queryRaw<Array<{ connection_ok: number }>>`
    SELECT 1 AS connection_ok
  `;

  if (rows[0]?.connection_ok !== 1) {
    throw new Error('Unexpected database response.');
  }

  console.info('Database connection OK: SELECT 1 returned 1.');
} catch {
  // Driver errors can include connection details. Keep credentials out of logs.
  console.error('Database check failed. Check DATABASE_URL and PostgreSQL availability.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
