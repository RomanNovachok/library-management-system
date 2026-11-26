export function readDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): URL {
  let url: URL;
  try {
    url = new URL(environment.DATABASE_URL ?? '');
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) {
    throw new Error('DATABASE_URL must name a PostgreSQL host and database.');
  }
  if (environment.NODE_ENV === 'production' && (
    url.searchParams.get('sslmode') !== 'verify-full'
    || url.searchParams.getAll('sslmode').length !== 1
    || url.searchParams.has('ssl')
    || environment.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  )) {
    throw new Error('Production DATABASE_URL requires sslmode=verify-full and TLS certificate verification.');
  }
  return url;
}
