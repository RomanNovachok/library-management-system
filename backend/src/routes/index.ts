import { json, Router } from 'express';
import type { Env } from '../config/env.js';
import type { BooksRepository } from '../modules/books/books.repository.js';
import { createBooksRouter } from '../modules/books/books.routes.js';
import type { BookCopiesRepository } from '../modules/book-copies/book-copies.repository.js';
import { createBookCopiesRouter } from '../modules/book-copies/book-copies.routes.js';
import { createReadersRouter } from '../modules/readers/readers.routes.js';
import type { ReadersRepository } from '../modules/readers/readers.repository.js';

export function createApiRouter(environment: Env['NODE_ENV'], booksRepository?: BooksRepository, bookCopiesRepository?: BookCopiesRepository, readersRepository?: ReadersRepository) {
  const apiRouter = Router();

  apiRouter.use('/books/:bookId/copies', createBookCopiesRouter(environment, bookCopiesRepository));
  apiRouter.use('/books', createBooksRouter(environment, booksRepository));
  apiRouter.use(createReadersRouter(environment, readersRepository));
  apiRouter.use(json({ limit: '100kb' }));
  apiRouter.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  return apiRouter;
}
