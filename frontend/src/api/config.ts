const configuredUrl = import.meta.env.VITE_API_URL?.trim();

function normalizeApiUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === '/api' || value === '/api/') return '/api';

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Unsupported API URL');
    }
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new Error('VITE_API_URL must be /api or an absolute HTTP(S) URL without credentials, query parameters or a fragment.');
  }
}

export const apiConfig = Object.freeze({ baseUrl: normalizeApiUrl(configuredUrl) });
