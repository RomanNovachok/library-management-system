import cors from 'cors';
import express from 'express';
import type { Env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { createApiRouter } from './routes/index.js';
import type { BooksRepository } from './modules/books/books.repository.js';
import type { BookCopiesRepository } from './modules/book-copies/book-copies.repository.js';
import type { ReadersRepository } from './modules/readers/readers.repository.js';

export function createApp(
  config: Pick<Env, 'CORS_ORIGIN'> & Partial<Pick<Env, 'NODE_ENV'>>,
  dependencies: { booksRepository?: BooksRepository; bookCopiesRepository?: BookCopiesRepository; readersRepository?: ReadersRepository } = {},
) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(cors({ origin: [config.CORS_ORIGIN] }));
  app.use('/api', createApiRouter(config.NODE_ENV ?? 'test', dependencies.booksRepository, dependencies.bookCopiesRepository, dependencies.readersRepository));
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
