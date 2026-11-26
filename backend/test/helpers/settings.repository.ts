import { randomUUID } from 'node:crypto';
import { damageRules } from '../../prisma/seed-library.js';
import type { DamageRule, Prisma } from '../../src/generated/prisma/client.js';
import type { SettingsRepository, SettingsWriteData } from '../../src/modules/settings/settings.repository.js';
import type { MemoryAuthRepository } from './auth.repository.js';
import type { MemoryReadersRepository } from './readers.repository.js';

export function memorySettingsRepository(auth: MemoryAuthRepository, readers: MemoryReadersRepository) {
  const rules: DamageRule[] = damageRules.map((rule) => ({ ...rule, id: randomUUID() }));
  const audits: Prisma.AuditLogUncheckedCreateInput[] = [];
  const withCount = (category: typeof readers.categoryRows[number]) => ({ ...category,
    _count: { readers: [...readers.readers.values()].filter((row) => row.categoryId === category.id).length },
  });
  const data: SettingsWriteData = {
    authenticate: (tokenHash, now) => auth.authenticate(tokenHash, now),
    findCategory: (id) => readers.findCategory(id),
    categoryNameExists: async (name, exceptId) => readers.categoryRows.some((row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase()),
    createCategory: async (input) => {
      const row = { id: randomUUID(), ...input };
      readers.categoryRows.push(row);
      return withCount(row);
    },
    updateCategory: async (id, { name, discountPercent }) => {
      const index = readers.categoryRows.findIndex((row) => row.id === id);
      const row = { ...readers.categoryRows[index]!, ...(name !== undefined && { name }), ...(discountPercent !== undefined && { discountPercent }) };
      readers.categoryRows[index] = row;
      return withCount(row);
    },
    findDamageRule: async (id) => rules.find((row) => row.id === id) ?? null,
    updateDamageRule: async (id, { label, penaltyPercent }) => {
      const index = rules.findIndex((row) => row.id === id);
      const row = { ...rules[index]!, ...(label !== undefined && { label }), ...(penaltyPercent !== undefined && { penaltyPercent }) };
      rules[index] = row;
      return row;
    },
  };
  return {
    audits,
    readerCategories: async () => readers.categoryRows.map(withCount),
    damageRules: async () => rules,
    transaction: (operation) => auth.transaction(() => operation(data)),
    recordAudit: async (entry) => { audits.push(entry); },
  } satisfies SettingsRepository & { audits: typeof audits };
}
