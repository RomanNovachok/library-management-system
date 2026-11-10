import cors from 'cors';
import express from 'express';
import type { Env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { apiRouter } from './routes/index.js';

export function createApp(config: Pick<Env, 'CORS_ORIGIN'>) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: [config.CORS_ORIGIN] }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', apiRouter);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
