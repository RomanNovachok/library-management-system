import { ApiError, getJson, requestJson } from './client';
import { isDamageRulesResponse, isRentalResponse, isRentalsResponse, isReturnPreviewResponse } from './rental-contract';
import type { IssueRentalInput, RentalStatus, ReturnInput } from './rental-contract';
import type { ConditionData } from './book-contract';

export async function getRentals(query: {
  search: string; page: number; pageSize: number; status: RentalStatus | ''; overdue: boolean; bookId: string;
}, signal: AbortSignal) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.overdue) params.set('overdue', 'true');
  if (query.bookId) params.set('bookId', query.bookId);
  const result = await getJson(`/rentals?${params}`, isRentalsResponse, signal);
  if (result.pagination.page !== query.page || result.pagination.pageSize !== query.pageSize) throw new ApiError('Сервер повернув дані іншої сторінки.');
  return result;
}

const rentalPath = (id: string) => `/rentals/${encodeURIComponent(id)}`;

export async function getRental(id: string, signal: AbortSignal) {
  const { data } = await getJson(rentalPath(id), isRentalResponse, signal);
  if (data.id !== id.toLowerCase()) throw new ApiError('Сервер повернув дані іншого прокату.');
  return data;
}

function unexpectedWriteResponse(status?: number, code?: string) {
  return new ApiError('Результат операції невідомий. Оновіть дані перед повторною спробою.', status, code, true);
}

async function saveRental(path: string, body: object, signal: AbortSignal, headers?: Record<string, string>) {
  try {
    return (await requestJson(path, { method: 'POST', signal, body, headers }, isRentalResponse)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status !== undefined && error.status >= 500) throw unexpectedWriteResponse(error.status, error.code);
    throw error;
  }
}

export async function issueRental(input: IssueRentalInput, terms: ConditionData & {
  dailyPrice: string; depositAmount: string; categoryName: string; discountPercent: string;
}, signal: AbortSignal) {
  // The version binds the cashier's displayed terms to the backend's locked rows.
  const readerId = input.readerId.toLowerCase();
  const copyId = input.copyId.toLowerCase();
  const values = [readerId, copyId, terms.dailyPrice, terms.depositAmount, terms.categoryName, terms.discountPercent,
    terms.condition, terms.conditionNotes];
  if (!globalThis.crypto?.subtle) throw new ApiError('Для підтвердження умов видачі відкрийте застосунок через HTTPS або локальну адресу.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
  const version = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  signal.throwIfAborted();
  const data = await saveRental('/rentals', input, signal, { 'X-Rental-Terms': version });
  if (data.copy.id !== copyId || data.reader.id !== readerId || data.status !== 'ACTIVE') throw unexpectedWriteResponse();
  return data;
}

export async function getDamageRules(signal: AbortSignal) {
  return (await getJson('/damage-rules', isDamageRulesResponse, signal)).data;
}

export async function getReturnPreview(id: string, input: ReturnInput, signal: AbortSignal) {
  const result = await requestJson(`${rentalPath(id)}/return-preview`, { method: 'POST', signal, body: input }, isReturnPreviewResponse)
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.outcomeUnknown) throw new ApiError('Не вдалося отримати розрахунок. Спробуйте оновити дані.');
      throw error;
    });
  const { data } = result;
  if (data.rentalId !== id.toLowerCase() || (data.status === 'LOST') !== (input.assessment.type === 'LOST')
    || (input.copyStatus && data.copyStatus !== input.copyStatus)) {
    throw new ApiError('Сервер повернув розрахунок для іншої операції. Оновіть дані.');
  }
  return data;
}

export async function closeRental(id: string, input: ReturnInput & { previewVersion: string }, signal: AbortSignal) {
  const data = await saveRental(`${rentalPath(id)}/close`, input, signal);
  if (data.id !== id.toLowerCase() || data.status !== (input.assessment.type === 'LOST' ? 'LOST' : 'RETURNED')) throw unexpectedWriteResponse();
  return data;
}
