import { ApiError, getJson } from './client';
import { isBookCopiesResponse, isBookDetailsResponse, isBooksResponse } from './book-contract';

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
