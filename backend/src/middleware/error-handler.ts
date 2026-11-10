import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      res.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
      });
      return;
    }

    if (error.type === 'entity.too.large') {
      res.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
      });
      return;
    }

    if ('status' in error && (error.status === 400 || error.status === 415)) {
      res.status(error.status).json({
        error: { code: 'INVALID_REQUEST', message: 'Invalid request body or encoding' },
      });
      return;
    }
  }

  console.error('Unhandled API error:', error);
  res.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
  });
};
