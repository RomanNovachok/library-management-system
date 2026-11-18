import { prisma } from '../src/lib/prisma.js';
import { assertLocalSeedTarget, SeedSafetyError, seedLibrary } from './seed-library.js';

try {
  assertLocalSeedTarget();
  const targets = await prisma.$transaction(seedLibrary, { timeout: 15000 });
  console.info('Seed completed; existing records preserved. Catalog targets:', targets);
} catch (error) {
  // Only authored safety errors are logged; driver errors may contain credentials.
  console.error(error instanceof SeedSafetyError
    ? error.message
    : 'Seed failed. Check applied migrations and the local database connection. No partial seed committed.');
  process.exitCode = 1;
} finally {
  try {
    await prisma.$disconnect();
  } catch {
    console.error('Failed to close the seed database connection.');
    process.exitCode = 1;
  }
}
