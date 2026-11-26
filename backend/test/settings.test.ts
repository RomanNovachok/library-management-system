import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionHash } from '../src/modules/auth/auth.service.js';
import { categoryCreate, categoryPatch, damageRulePatch } from '../src/modules/settings/settings.schemas.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { requestSession } from './helpers/auth.repository.js';
import { MemoryReadersRepository } from './helpers/readers.repository.js';
import { memorySettingsRepository } from './helpers/settings.repository.js';

test('settings schemas normalize names and accept exact decimal strings only', () => {
  for (const [input, output] of [['0', '0.00'], ['12.3', '12.30'], ['12.34', '12.34'], ['100.00', '100.00']]) {
    const category = categoryCreate.parse({ name: '  Тест\t група ', discountPercent: input });
    assert.equal(category.name, 'Тест група');
    assert.equal(category.discountPercent.toFixed(2), output);
  }
  for (const discountPercent of [-1, '0.001', '100.01', ' 10 ', '1e2', null]) assert.equal(categoryPatch.safeParse({ discountPercent }).success, false);
  for (const patch of [{}, { name: ' ' }, { name: 'а'.repeat(101) }, { name: 'a\0b' }, { actorId: 'ignored' }]) assert.equal(categoryPatch.safeParse(patch).success, false);
  for (const patch of [{}, { code: 'NONE' }, { outcome: 'AVAILABLE' }, { label: ' ' }]) assert.equal(damageRulePatch.safeParse(patch).success, false);
});

test('service rechecks write authority and audits only a committed change', async (t) => {
  for (const [role, status] of [['ADMIN', 401], ['LIBRARIAN', 403]] as const) {
    const session = await requestSession(role);
    const auth = session.repository;
    const repository = memorySettingsRepository(auth, new MemoryReadersRepository());
    const service = new SettingsService(repository);
    const tokenHash = sessionHash(session.cookie.slice('library_session='.length));
    const data = categoryCreate.parse({ name: 'Чинна категорія', discountPercent: '25.50' });
    if (role === 'ADMIN') {
      const created = await service.createCategory(tokenHash, data);
      const detail = await auth.authenticate(tokenHash, new Date());
      assert.deepEqual(repository.audits[0]?.details, { before: null, after: { name: data.name, discountPercent: '25.50' } });
      assert.equal(repository.audits[0]?.actorId, detail?.id);
      const failedAudit = t.mock.method(repository, 'recordAudit', async () => { throw new Error('Audit fixture failed'); });
      const logged = t.mock.method(console, 'error', () => {});
      const updated = await service.updateCategory(tokenHash, created.id, categoryPatch.parse({ discountPercent: '30' }));
      assert.equal(updated.discountPercent, '30.00');
      assert.equal((await service.readerCategories()).find(({ id }) => id === created.id)?.discountPercent, '30.00');
      assert.equal(failedAudit.mock.callCount(), 1);
      assert.equal(logged.mock.callCount(), 1);
      await auth.deleteSession(tokenHash);
    }
    await assert.rejects(service.createCategory(tokenHash, data), { status });
    assert.equal(repository.audits.length, role === 'ADMIN' ? 1 : 0);
  }
});
