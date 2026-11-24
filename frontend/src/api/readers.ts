import { ApiError, getJson, requestJson } from './client';
import { isReaderCategoriesResponse, isReaderRentalsResponse, isReaderResponse, isReadersResponse } from './reader-contract';
import type { Page, ReaderInput } from './reader-contract';

function checkPage<T>(result: Page<T>, query: { page: number; pageSize: number }) {
  if (result.pagination.page !== query.page || result.pagination.pageSize !== query.pageSize) throw new ApiError('Сервер повернув дані для іншої сторінки.');
  return result;
}
export async function getReaders(query: { search: string; categoryId: string; page: number; pageSize: number }, signal: AbortSignal) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  return checkPage(await getJson(`/readers?${params}`, isReadersResponse, signal), query);
}
export async function getReader(id: string, signal: AbortSignal) {
  const { data } = await getJson(`/readers/${encodeURIComponent(id)}`, isReaderResponse, signal);
  if (data.id.toLowerCase() !== id.toLowerCase()) throw new ApiError('Сервер повернув іншого читача.');
  return data;
}
export async function getReaderCategories(signal: AbortSignal) {
  return (await getJson('/reader-categories', isReaderCategoriesResponse, signal)).data;
}
export async function getReaderRentals(id: string, query: { page: number; pageSize: number }, signal: AbortSignal) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  const result = checkPage(await getJson(`/readers/${encodeURIComponent(id)}/rentals?${params}`, isReaderRentalsResponse, signal), query);
  if (result.data.some((rental) => rental.readerId.toLowerCase() !== id.toLowerCase())) throw new ApiError('Сервер повернув історію іншого читача.');
  return result;
}
export async function createReader(input: ReaderInput, signal: AbortSignal) {
  return (await requestJson('/readers', { method: 'POST', body: input, signal }, isReaderResponse)).data;
}
export async function updateReader(id: string, input: Partial<ReaderInput>, signal: AbortSignal) {
  const { data } = await requestJson(`/readers/${encodeURIComponent(id)}`, { method: 'PATCH', body: input, signal }, isReaderResponse);
  if (data.id.toLowerCase() !== id.toLowerCase()) throw new ApiError('Сервер повернув іншого читача. Оновіть дані.', undefined, undefined, true);
  return data;
}
