import { apiConfig } from './config';
import { apiErrorMessage } from './error-messages';

export class ApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly outcomeUnknown: boolean;

  constructor(message: string, status?: number, code?: string, outcomeUnknown = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.outcomeUnknown = outcomeUnknown;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  signal: AbortSignal;
  body?: object;
}

export function requestJson<T>(path: string, options: RequestOptions, validate: (value: unknown) => value is T): Promise<T>;
export function requestJson(path: string, options: RequestOptions): Promise<void>;
export async function requestJson<T>(path: string, options: RequestOptions, validate?: (value: unknown) => value is T): Promise<T | void> {
  const { signal, method, body: requestBody } = options;
  const isMutation = method !== 'GET';
  const uncertainMessage = ' Результат операції невідомий. Оновіть дані перед повторною спробою.';
  if (!apiConfig.baseUrl) {
    throw new ApiError('Не налаштовано адресу API. Вкажіть VITE_API_URL у frontend/.env та перезапустіть frontend.');
  }

  let response: Response;
  try {
    response = await fetch(`${apiConfig.baseUrl}${path}`, {
      signal, method,
      headers: { Accept: 'application/json', ...(requestBody !== undefined && { 'Content-Type': 'application/json' }) },
      ...(requestBody !== undefined && { body: JSON.stringify(requestBody) }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(`Не вдалося з’єднатися із сервером. Перевірте підключення та доступність backend.${isMutation ? uncertainMessage : ''}`, undefined, undefined, isMutation);
  }

  // HTTP status remains useful even if a proxy returns HTML instead of JSON.
  if (!response.ok) {
    let code: string | undefined;
    try {
      const body: unknown = await response.json();
      if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string') code = body.error.code;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    throw new ApiError(apiErrorMessage(response.status, code), response.status, code);
  }

  if (!validate && response.status === 204) return;
  if (!validate) throw new ApiError(`Сервер не підтвердив завершення операції.${uncertainMessage}`, undefined, undefined, isMutation);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(`Сервер повернув некоректну JSON-відповідь.${isMutation ? uncertainMessage : ' Спробуйте ще раз.'}`, undefined, undefined, isMutation);
  }
  if (!validate(body)) throw new ApiError(`Формат відповіді сервера не відповідає Books API.${isMutation ? uncertainMessage : ' Спробуйте ще раз.'}`, undefined, undefined, isMutation);
  return body;
}

export function getJson<T>(path: string, validate: (value: unknown) => value is T, signal: AbortSignal): Promise<T> {
  return requestJson(path, { method: 'GET', signal }, validate);
}
