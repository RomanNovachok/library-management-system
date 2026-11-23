import { ApiError, getJson, requestJson } from './client';
import { isBookCopiesResponse, isBookCopyResponse, isBookDetailsResponse, isBookResponse, isBooksResponse } from './book-contract';
import type { BookInput, CopyInput, CopyUpdateInput } from './book-contract';

export async function getBooks(query: { search: string; page: number; pageSize: number }, signal: AbortSignal) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set('search', query.search);
  const result = await getJson(`/books?${params}`, isBooksResponse, signal);
  if (result.pagination.page !== query.page || result.pagination.pageSize !== query.pageSize) {
    throw new ApiError('Сервер повернув дані для іншої сторінки. Спробуйте ще раз.');
  }
  return result;
}

export async function getBook(id: string, signal: AbortSignal) {
  const result = await getJson(`/books/${encodeURIComponent(id)}`, isBookDetailsResponse, signal);
  if (result.data.id.toLowerCase() !== id.toLowerCase()) throw new ApiError('Сервер повернув іншу книгу.');
  return result.data;
}

export async function getBookCopies(bookId: string, signal: AbortSignal) {
  const result = await getJson(`/books/${encodeURIComponent(bookId)}/copies`, isBookCopiesResponse, signal);
  if (result.data.some((copy) => copy.bookId.toLowerCase() !== bookId.toLowerCase())) {
    throw new ApiError('Сервер повернув примірники іншої книги.');
  }
  return result.data;
}

export async function createBook(input: BookInput, signal: AbortSignal) {
  return (await requestJson('/books', { method: 'POST', body: input, signal }, isBookResponse)).data;
}

export async function updateBook(id: string, input: BookInput, signal: AbortSignal) {
  return (await requestJson(`/books/${encodeURIComponent(id)}`, { method: 'PATCH', body: input, signal }, isBookDetailsResponse)).data;
}

export function archiveBook(id: string, signal: AbortSignal) {
  return requestJson(`/books/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
}

export async function createBookCopy(bookId: string, input: CopyInput, signal: AbortSignal) {
  return (await requestJson(`/books/${encodeURIComponent(bookId)}/copies`, { method: 'POST', body: input, signal }, isBookCopyResponse)).data;
}

export async function updateBookCopy(bookId: string, copyId: string, input: CopyUpdateInput, signal: AbortSignal) {
  return (await requestJson(`/books/${encodeURIComponent(bookId)}/copies/${encodeURIComponent(copyId)}`, { method: 'PATCH', body: input, signal }, isBookCopyResponse)).data;
}

export function deleteBookCopy(bookId: string, copyId: string, signal: AbortSignal) {
  return requestJson(`/books/${encodeURIComponent(bookId)}/copies/${encodeURIComponent(copyId)}`, { method: 'DELETE', signal });
}
