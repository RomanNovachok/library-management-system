import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { CopyStatus, DamageOutcome, Prisma } from '../src/generated/prisma/client.js';
import { assertLocalSeedTarget, damageRules, demoBooks, readerCategories, SeedSafetyError, seedLibrary } from '../prisma/seed-library.js';

async function snapshot(db: Prisma.TransactionClient): Promise<string> {
  return JSON.stringify(await Promise.all([
    db.readerCategory.findMany({ orderBy: { id: 'asc' } }),
    db.damageRule.findMany({ orderBy: { id: 'asc' } }),
    db.book.findMany({ orderBy: { id: 'asc' } }),
    db.bookCopy.findMany({ orderBy: { id: 'asc' } }),
  ]));
}

async function assertNoOperationalRecords(db: Prisma.TransactionClient) {
  const counts = await Promise.all([
    db.reader.count(), db.rental.count(), db.cashMovement.count(), db.staffUser.count(), db.auditLog.count(),
  ]);
  assert.deepEqual(counts, [0, 0, 0, 0, 0], 'This initial seed check expects no readers, rentals, cash movements, staff or audit records.');
}

try {
  assertLocalSeedTarget();
  await assertNoOperationalRecords(prisma);
  for (const category of readerCategories) {
    assert.ok(await prisma.readerCategory.findUnique({ where: { name: category.name } }));
  }
  for (const rule of damageRules) {
    assert.ok(await prisma.damageRule.findUnique({ where: { code: rule.code } }));
  }
  for (const book of demoBooks) {
    assert.ok(await prisma.book.findUnique({ where: { id: book.id } }));
    const copies = await prisma.bookCopy.findMany({ where: { inventoryCode: { in: [...book.inventoryCodes] } } });
    assert.equal(copies.length, book.inventoryCodes.length);
    assert.ok(copies.every((copy) => copy.bookId === book.id));
  }

  const original = await snapshot(prisma);
  const rollback = new Error('Rollback seed preservation checks.');
  await assert.rejects(prisma.$transaction(async (tx) => {
    await seedLibrary(tx);
    assert.equal(await snapshot(tx), original, 'A repeated seed must preserve every existing catalog row.');

    await tx.book.update({
      where: { id: demoBooks[0].id },
      data: { title: 'Edited within rollback test', dailyPrice: new Prisma.Decimal('19.75'), depositAmount: new Prisma.Decimal('999.99'), archivedAt: new Date('2026-01-01T00:00:00Z') },
    });
    await tx.readerCategory.update({ where: { name: readerCategories[0].name }, data: { discountPercent: new Prisma.Decimal('33.33') } });
    await tx.damageRule.update({
      where: { code: damageRules[0].code },
      data: { label: 'Edited within rollback test', penaltyPercent: new Prisma.Decimal('21.25'), outcome: DamageOutcome.MAINTENANCE },
    });
    for (const status of [CopyStatus.RENTED, CopyStatus.MAINTENANCE, CopyStatus.LOST]) {
      await tx.bookCopy.update({ where: { inventoryCode: demoBooks[0].inventoryCodes[0] }, data: { status } });
      const edited = await snapshot(tx);
      await seedLibrary(tx);
      assert.equal(await snapshot(tx), edited, `Seed must preserve edited tariffs, discounts, rules, titles, archive flags and ${status} copy status.`);
    }
    await assertNoOperationalRecords(tx);
    throw rollback;
  }, { timeout: 30000 }), (error: unknown) => error === rollback);
  assert.equal(await snapshot(prisma), original, 'All temporary edits must be rolled back.');

  // Free one category name temporarily so seed really inserts a row before the collision.
  const categoryCount = await prisma.readerCategory.count();
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.readerCategory.update({ where: { name: readerCategories[0].name }, data: { name: `rollback-${randomUUID()}` } });
    await tx.bookCopy.update({ where: { inventoryCode: demoBooks[0].inventoryCodes[0] }, data: { bookId: demoBooks[1].id } });
    try {
      await seedLibrary(tx);
      assert.fail('An inventory collision must abort seed.');
    } catch (error) {
      if (error instanceof SeedSafetyError) assert.equal(await tx.readerCategory.count(), categoryCount + 1);
      throw error;
    }
  }, { timeout: 15000 }), (error: unknown) => error instanceof SeedSafetyError && error.message.includes('INV-0001'));
  assert.equal(await snapshot(prisma), original, 'Inventory collision must roll back partial inserts and preserve existing data.');
  await assertNoOperationalRecords(prisma);

  console.info('Seed checks passed: stable book/copy links; no duplicates; changed discounts, tariffs, rules and all non-AVAILABLE copy statuses preserved; partial inserts and test edits rolled back.');
  console.info('Readers, rentals, cash movements, staff users and audit logs remain empty.');
} catch (error) {
  console.error(error instanceof assert.AssertionError || error instanceof SeedSafetyError
    ? error.message
    : 'Seed verification failed. Check migrations and local database availability; connection details omitted.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
