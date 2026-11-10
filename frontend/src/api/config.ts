// Configuration only. Request functions will be added with the API integration.
const configuredUrl = import.meta.env.VITE_API_URL?.trim();

function normalizeApiUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Unsupported API URL');
    }
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new Error('VITE_API_URL must be an absolute HTTP(S) URL without credentials, query parameters or a fragment.');
  }
}

export const apiConfig = Object.freeze({ baseUrl: normalizeApiUrl(configuredUrl) });
