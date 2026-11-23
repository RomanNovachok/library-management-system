import type { BookInput, CopyUpdateInput, EditableCopyStatus } from '../api/book-contract';

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export function normalizeMoneyInput(value: string): string | undefined {
  const normalized = value.trim().replace(',', '.');
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(normalized)) return undefined;
  const [integer, fraction = ''] = normalized.split('.');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

export function validateBookInput(values: BookInput): { data?: BookInput; errors: FieldErrors<BookInput> } {
  const errors: FieldErrors<BookInput> = {};
  const data = { ...values };
  for (const field of ['title', 'author', 'genre'] as const) {
    data[field] = values[field].trim();
    if (!data[field]) errors[field] = 'Заповніть це поле.';
    else if (data[field].length > 1000) errors[field] = 'Дозволено не більше 1000 символів.';
  }
  for (const field of ['dailyPrice', 'depositAmount'] as const) {
    const normalized = normalizeMoneyInput(values[field]);
    if (!normalized) errors[field] = 'Вкажіть суму від 0 до 9 999 999 999,99, максимум два знаки після коми.';
    else data[field] = normalized;
  }
  return { data: Object.keys(errors).length ? undefined : data, errors };
}

export function canChangeCopyStatus(status: string): status is EditableCopyStatus {
  return status === 'AVAILABLE' || status === 'MAINTENANCE';
}

export function validateCopyInput(inventoryCode: string, status: string, originalStatus?: string): { data?: CopyUpdateInput; errors: FieldErrors<CopyUpdateInput> } {
  const errors: FieldErrors<CopyUpdateInput> = {};
  const code = inventoryCode.trim();
  if (!code) errors.inventoryCode = 'Вкажіть інвентарний номер.';
  else if (code.length > 100 || code.includes('\0')) errors.inventoryCode = 'Дозволено 1–100 символів без нульового символу.';
  const data: CopyUpdateInput = { inventoryCode: code };
  if (originalStatus !== undefined) {
    if (canChangeCopyStatus(originalStatus)) {
      if (!canChangeCopyStatus(status)) errors.status = 'Дозволені лише статуси «Доступний» і «На обслуговуванні».';
      else if (status !== originalStatus) data.status = status;
    } else if (status !== originalStatus) errors.status = 'Статус виданого або втраченого примірника змінювати не можна.';
  }
  return { data: Object.keys(errors).length ? undefined : data, errors };
}
