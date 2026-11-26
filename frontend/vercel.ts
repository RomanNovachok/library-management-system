const backendOrigin = process.env.RENDER_API_ORIGIN;

// Resolve the upstream at build time. Requests cannot choose their destination.
if (backendOrigin && !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com$/.test(backendOrigin)) {
  throw new Error('RENDER_API_ORIGIN must be the HTTPS origin of the Render service.');
}
if (!backendOrigin && process.env.VERCEL_ENV === 'production') {
  throw new Error('Set RENDER_API_ORIGIN before deploying to production.');
}

export const config = {
  framework: 'vite',
  installCommand: 'npm ci --include=dev',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    ...(backendOrigin ? [
      { source: '/api/:path*', destination: `${backendOrigin}/api/:path*` },
    ] : []),
    { source: '/((?!(?:[aA][pP][iI]|assets)(?:/|$)).*)', destination: '/index.html' },
  ],
};
