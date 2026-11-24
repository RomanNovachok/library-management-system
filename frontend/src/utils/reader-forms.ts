import type { ReaderCategory, ReaderInput } from '../api/reader-contract';

export function validateReaderInput(values: ReaderInput, categories: ReaderCategory[]) {
  const data: ReaderInput = { fullName: values.fullName.trim(), address: values.address.trim(), phone: values.phone.trim(), categoryId: values.categoryId };
  const errors: Partial<Record<keyof ReaderInput, string>> = {};
  for (const [field, min, max, label] of [
    ['fullName', 2, 200, 'ПІБ'], ['address', 3, 500, 'Адреса'],
  ] as const) {
    if (data[field].length < min || data[field].length > max || [...data[field]].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) errors[field] = `${label}: від ${min} до ${max} символів без керувальних символів.`;
  }
  const digits = data.phone.replace(/\D/g, '').length;
  if (data.phone.length < 7 || data.phone.length > 30 || !/^\+?[0-9 ().-]+$/.test(data.phone) || digits < 7 || digits > 15) {
    errors.phone = 'Вкажіть телефон: 7–15 цифр, можна використовувати + на початку, пробіли, дужки, дефіс і крапку.';
  }
  if (!categories.some((category) => category.id === data.categoryId)) errors.categoryId = 'Виберіть категорію зі списку.';
  return { data: Object.keys(errors).length ? undefined : data, errors };
}

export function readerListQuery(params: URLSearchParams) {
  return { search: (params.get('search') ?? '').trim(), categoryId: params.get('categoryId') ?? '',
    page: positivePage(params.get('page')), pageSize: positivePage(params.get('pageSize'), 20, 100) };
}
export function positivePage(value: string | null, fallback = 1, max = 1_000_000) {
  return value && /^[1-9]\d{0,6}$/.test(value) && Number(value) <= max ? Number(value) : fallback;
}
