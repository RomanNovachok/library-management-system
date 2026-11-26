import { Prisma, type DamageRule, type PrismaClient, type ReaderCategory } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import { writeAuditLog } from '../../lib/audit-log.js';
import { lockStaffWrites, PrismaAuthRepository, type StaffIdentity } from '../auth/auth.repository.js';
import type { CategoryCreate, CategoryPatch, DamageRulePatch } from './settings.schemas.js';

type CategoryWithCount = ReaderCategory & { _count: { readers: number } };
const includeCount = { _count: { select: { readers: true } } } as const;
export const duplicateCategory = () => new ApiError(409, 'READER_CATEGORY_NAME_EXISTS', 'Категорія з такою назвою вже існує');

export async function readerCategoryNameExists(db: Prisma.TransactionClient, name: string, exceptId?: string) {
  const [result] = await db.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM "ReaderCategory"
      WHERE lower("name") = lower(${name}) AND "id" IS DISTINCT FROM ${exceptId ?? null}::uuid) AS found
  `;
  return result!.found;
}

export interface SettingsWriteData {
  authenticate(tokenHash: string, now: Date): Promise<StaffIdentity | null>;
  findCategory(id: string): Promise<ReaderCategory | null>;
  categoryNameExists(name: string, exceptId?: string): Promise<boolean>;
  createCategory(input: CategoryCreate): Promise<CategoryWithCount>;
  updateCategory(id: string, input: CategoryPatch): Promise<CategoryWithCount>;
  findDamageRule(id: string): Promise<DamageRule | null>;
  updateDamageRule(id: string, input: DamageRulePatch): Promise<DamageRule>;
}

export interface SettingsRepository {
  readerCategories(): Promise<CategoryWithCount[]>;
  damageRules(): Promise<DamageRule[]>;
  transaction<T>(operation: (data: SettingsWriteData) => Promise<T>): Promise<T>;
  recordAudit(data: Prisma.AuditLogUncheckedCreateInput): Promise<void>;
}

class PrismaSettingsData implements SettingsWriteData {
  constructor(private readonly db: Prisma.TransactionClient) {}

  authenticate(tokenHash: string, now: Date) {
    return new PrismaAuthRepository(this.db).authenticate(tokenHash, now);
  }

  findCategory(id: string) {
    return this.db.readerCategory.findUnique({ where: { id } });
  }

  categoryNameExists(name: string, exceptId?: string) {
    return readerCategoryNameExists(this.db, name, exceptId);
  }

  createCategory(data: CategoryCreate) {
    return this.db.readerCategory.create({ data, include: includeCount });
  }

  updateCategory(id: string, { name, discountPercent }: CategoryPatch) {
    const data = { ...(name !== undefined && { name }), ...(discountPercent !== undefined && { discountPercent }) };
    return this.db.readerCategory.update({ where: { id }, data, include: includeCount });
  }

  findDamageRule(id: string) {
    return this.db.damageRule.findUnique({ where: { id } });
  }

  updateDamageRule(id: string, { label, penaltyPercent }: DamageRulePatch) {
    const data = { ...(label !== undefined && { label }), ...(penaltyPercent !== undefined && { penaltyPercent }) };
    return this.db.damageRule.update({ where: { id }, data });
  }
}

export class PrismaSettingsRepository implements SettingsRepository {
  constructor(private readonly database?: PrismaClient) {}

  private async db() {
    return this.database ?? (await import('../../lib/prisma.js')).prisma;
  }

  async readerCategories() {
    return (await this.db()).readerCategory.findMany({ orderBy: { name: 'asc' }, include: includeCount });
  }

  async damageRules() {
    return (await this.db()).damageRule.findMany({ orderBy: { code: 'asc' } });
  }

  async transaction<T>(operation: (data: SettingsWriteData) => Promise<T>) {
    const db = await this.db();
    try {
      return await db.$transaction(async (tx) => {
        // This also serializes case-insensitive category name checks with settings updates.
        await lockStaffWrites(tx);
        return operation(new PrismaSettingsData(tx));
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateCategory();
      throw error;
    }
  }

  recordAudit(data: Prisma.AuditLogUncheckedCreateInput) {
    return writeAuditLog(data, this.database);
  }
}
