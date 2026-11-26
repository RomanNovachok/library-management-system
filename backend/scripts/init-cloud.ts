import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { checkCloudDatabase, cloudTarget, initializeCloudLibrary } from '../prisma/cloud-library.js';
import { SeedSafetyError } from '../prisma/seed-library.js';

async function main() {
  const args = process.argv.slice(2);
  const includeDemoCatalog = args.length === 1 && args[0] === '--demo-catalog';
  if (args.length && !includeDemoCatalog) throw new SeedSafetyError('Supported option: --demo-catalog.');
  if (!stdin.isTTY || !stdout.isTTY) throw new SeedSafetyError('An interactive terminal is required.');
  const target = cloudTarget();
  const { prisma } = await import('../src/lib/prisma.js');
  try {
    await prisma.$transaction((tx) => checkCloudDatabase(tx, target));
    console.info(`Neon target: ${target.endpoint} (role ${target.username}, schema public).`);
    console.info(includeDemoCatalog ? 'Initialize settings and demo catalog.' : 'Initialize settings.');
    const reader = createInterface({ input: stdin, output: stdout });
    const confirmation = await reader.question('Type the target host/database to confirm: ').finally(() => reader.close());
    if (confirmation.trim() !== target.endpoint) throw new SeedSafetyError('Initialization cancelled.');
    await prisma.$transaction((tx) => initializeCloudLibrary(tx, target, includeDemoCatalog), { timeout: 30_000 });
    console.info('Initialization complete. Existing records preserved.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof SeedSafetyError ? error.message : 'Initialization failed. Check the direct Neon URL, TLS and applied migrations.');
  process.exitCode = 1;
});
