import { apiConfig } from './config';

export class ApiError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function getJson<T>(path: string, validate: (value: unknown) => value is T, signal: AbortSignal): Promise<T> {
  if (!apiConfig.baseUrl) {
    throw new ApiError('Не налаштовано адресу API. Вкажіть VITE_API_URL у frontend/.env та перезапустіть frontend.');
  }

  let response: Response;
  try {
    response = await fetch(`${apiConfig.baseUrl}${path}`, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError('Не вдалося з’єднатися із сервером. Перевірте підключення та доступність backend.');
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
    const message = response.status === 404 ? 'Книгу не знайдено.'
      : response.status === 400 ? 'Некоректні параметри запиту. Перевірте адресу та умови пошуку.'
      : response.status === 403 ? 'Немає доступу до цих даних.'
      : response.status >= 500 ? 'Сервер тимчасово не може завантажити дані. Спробуйте ще раз пізніше.'
      : `Не вдалося завантажити дані (HTTP ${response.status}).`;
    throw new ApiError(message, response.status, code);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError('Сервер повернув некоректну JSON-відповідь. Спробуйте ще раз.');
  }
  if (!validate(body)) throw new ApiError('Формат відповіді сервера не відповідає Books API. Спробуйте ще раз.');
  return body;
}
