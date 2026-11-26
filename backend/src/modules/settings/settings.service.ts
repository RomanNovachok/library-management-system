import type { DamageRule, Prisma, ReaderCategory } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import { forbidden, unauthenticated } from '../auth/auth.service.js';
import { duplicateCategory, type SettingsRepository, type SettingsWriteData } from './settings.repository.js';
import type { CategoryCreate, CategoryPatch, DamageRulePatch } from './settings.schemas.js';

const categoryValues = ({ name, discountPercent }: ReaderCategory) => ({ name, discountPercent: discountPercent.toFixed(2) });
const ruleValues = ({ label, penaltyPercent }: DamageRule) => ({ label, penaltyPercent: penaltyPercent.toFixed(2) });
const categoryJson = (category: ReaderCategory & { _count: { readers: number } }) => ({
  id: category.id, ...categoryValues(category), readerCount: category._count.readers,
});
const ruleJson = (rule: DamageRule) => ({ id: rule.id, code: rule.code, outcome: rule.outcome, ...ruleValues(rule) });

function changes(before: Record<string, string>, after: Record<string, string>) {
  const fields = Object.keys(after).filter((key) => before[key] !== after[key]);
  return {
    before: Object.fromEntries(fields.map((key) => [key, before[key]!])),
    after: Object.fromEntries(fields.map((key) => [key, after[key]!])),
  };
}

type AuditChange = Pick<Prisma.AuditLogUncheckedCreateInput, 'action' | 'entityType' | 'entityId' | 'details'>;

export class SettingsService {
  constructor(private readonly repository: SettingsRepository, private readonly now: () => Date = () => new Date()) {}

  async readerCategories() { return (await this.repository.readerCategories()).map(categoryJson); }
  async damageRules() { return (await this.repository.damageRules()).map(ruleJson); }

  createCategory(tokenHash: string, input: CategoryCreate) {
    return this.write(tokenHash, async (db) => {
      if (await db.categoryNameExists(input.name)) throw duplicateCategory();
      const category = await db.createCategory(input);
      return { data: categoryJson(category), audit: {
        action: 'READER_CATEGORY_CREATED', entityType: 'ReaderCategory', entityId: category.id,
        details: { before: null, after: categoryValues(category) },
      } };
    });
  }

  updateCategory(tokenHash: string, id: string, input: CategoryPatch) {
    return this.write(tokenHash, async (db) => {
      const previous = await db.findCategory(id);
      if (!previous) throw new ApiError(404, 'READER_CATEGORY_NOT_FOUND', 'Категорію не знайдено');
      if (input.name !== undefined && input.name !== previous.name && await db.categoryNameExists(input.name, id)) throw duplicateCategory();
      const category = await db.updateCategory(id, input);
      return { data: categoryJson(category), audit: {
        action: 'READER_CATEGORY_UPDATED', entityType: 'ReaderCategory', entityId: id,
        details: changes(categoryValues(previous), categoryValues(category)),
      } };
    });
  }

  updateDamageRule(tokenHash: string, id: string, input: DamageRulePatch) {
    return this.write(tokenHash, async (db) => {
      const previous = await db.findDamageRule(id);
      if (!previous) throw new ApiError(404, 'DAMAGE_RULE_NOT_FOUND', 'Правило пошкодження не знайдено');
      const { penaltyPercent } = input;
      if (penaltyPercent !== undefined && previous.code !== 'MINOR' && previous.code !== 'MAJOR'
        && !((previous.code === 'NONE' && penaltyPercent.isZero()) || (previous.code === 'LOST' && penaltyPercent.eq(100)))) {
        throw new ApiError(400, 'DAMAGE_RULE_RATE_FIXED', 'Ставку цього правила зафіксовано');
      }
      const rule = await db.updateDamageRule(id, input);
      return { data: ruleJson(rule), audit: {
        action: 'DAMAGE_RULE_UPDATED', entityType: 'DamageRule', entityId: id,
        details: changes(ruleValues(previous), ruleValues(rule)),
      } };
    });
  }

  private async write<T>(tokenHash: string, operation: (db: SettingsWriteData) => Promise<{ data: T; audit: AuditChange }>) {
    const { data, audit } = await this.repository.transaction(async (db) => {
      const actor = await db.authenticate(tokenHash, this.now());
      if (!actor) throw unauthenticated();
      if (actor.role !== 'ADMIN') throw forbidden();
      const { data, audit } = await operation(db);
      return { data, audit: { ...audit, actorId: actor.id, createdAt: this.now() } };
    });
    try {
      await this.repository.recordAudit(audit);
    } catch {
      console.error('Settings audit failed', audit.action, audit.entityId);
    }
    return data;
  }
}
