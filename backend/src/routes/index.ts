import { json, Router } from 'express';
import type { Env } from '../config/env.js';
import type { BooksRepository } from '../modules/books/books.repository.js';
import { createBooksRouter } from '../modules/books/books.routes.js';

export function createApiRouter(environment: Env['NODE_ENV'], booksRepository?: BooksRepository) {
  const apiRouter = Router();

  apiRouter.use('/books', createBooksRouter(environment, booksRepository));
  apiRouter.use(json({ limit: '100kb' }));
  apiRouter.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  return apiRouter;
}
