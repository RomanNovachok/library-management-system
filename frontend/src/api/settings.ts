import { ApiError, getJson, requestJson } from './client';
import { isReaderCategory, record, type ReaderCategory } from './reader-contract';
import { isDamageRule, isDamageRulesResponse, type DamageRule } from './rental-contract';

export type AdminReaderCategory = ReaderCategory & { readerCount: number };
type CategoryInput = Pick<ReaderCategory, 'name' | 'discountPercent'>;
type RuleInput = Partial<Pick<DamageRule, 'label' | 'penaltyPercent'>>;

const categoriesPath = '/settings/reader-categories';
const rulesPath = '/settings/damage-rules';

function isAdminCategory(value: unknown): value is AdminReaderCategory {
  return isReaderCategory(value) && 'readerCount' in value && typeof value.readerCount === 'number'
    && Number.isSafeInteger(value.readerCount) && value.readerCount >= 0;
}

const categoryList = (value: unknown): value is { data: AdminReaderCategory[] } =>
  record(value) && Array.isArray(value.data) && value.data.every(isAdminCategory);
const categoryResponse = (value: unknown): value is { data: AdminReaderCategory } => record(value) && isAdminCategory(value.data);
const ruleResponse = (value: unknown): value is { data: DamageRule } => record(value) && isDamageRule(value.data);

async function saveSetting<T>(path: string, method: 'POST' | 'PATCH', body: object, signal: AbortSignal, validate: (value: unknown) => value is { data: T }) {
  try {
    return (await requestJson(path, { method, body, signal }, validate)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status !== undefined && error.status >= 500) {
      throw new ApiError(`${error.message} Оновіть дані перед повторною спробою.`, error.status, error.code, true);
    }
    throw error;
  }
}

function updatedItem<T extends { id: string }>(data: T, id: string) {
  if (data.id.toLowerCase() !== id.toLowerCase()) throw new ApiError('Результат збереження невідомий. Оновіть дані.', undefined, undefined, true);
  return data;
}

export async function listAdminCategories(signal: AbortSignal) {
  return (await getJson(categoriesPath, categoryList, signal)).data;
}
export async function listAdminDamageRules(signal: AbortSignal) {
  return (await getJson(rulesPath, isDamageRulesResponse, signal)).data;
}
export function createCategory(body: CategoryInput, signal: AbortSignal) {
  return saveSetting(categoriesPath, 'POST', body, signal, categoryResponse);
}
export async function updateCategory(id: string, body: Partial<CategoryInput>, signal: AbortSignal) {
  const data = await saveSetting(`${categoriesPath}/${encodeURIComponent(id)}`, 'PATCH', body, signal, categoryResponse);
  return updatedItem(data, id);
}
export async function updateDamageRule(id: string, body: RuleInput, signal: AbortSignal) {
  const data = await saveSetting(`${rulesPath}/${encodeURIComponent(id)}`, 'PATCH', body, signal, ruleResponse);
  return updatedItem(data, id);
}
