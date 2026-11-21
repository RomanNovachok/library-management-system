import { json, Router } from 'express';
import type { Env } from '../../config/env.js';
import { developmentLoopbackOnly } from '../../middleware/development-loopback-only.js';
import { BooksController } from './books.controller.js';
import { BooksService } from './books.service.js';
import { PrismaBooksRepository } from './books.repository.js';
import type { BooksRepository } from './books.repository.js';

export function createBooksRouter(environment: Env['NODE_ENV'], repository: BooksRepository = new PrismaBooksRepository()) {
  const router = Router();
  const controller = new BooksController(new BooksService(repository));
  const localAdmin = developmentLoopbackOnly(environment);

  router.use((req, res, next) => {
    if (['POST', 'PATCH', 'DELETE'].includes(req.method)) localAdmin(req, res, next);
    else next();
  });
  router.use(json({ limit: '100kb' }));
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/', controller.create);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.archive);
  return router;
}
