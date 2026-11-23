import { json, Router } from 'express';
import type { Env } from '../../config/env.js';
import { developmentLoopbackOnly } from '../../middleware/development-loopback-only.js';
import { BookCopiesController } from './book-copies.controller.js';
import { PrismaBookCopiesRepository } from './book-copies.repository.js';
import type { BookCopiesRepository } from './book-copies.repository.js';
import { BookCopiesService } from './book-copies.service.js';

export function createBookCopiesRouter(environment: Env['NODE_ENV'], repository: BookCopiesRepository = new PrismaBookCopiesRepository()) {
  const router = Router({ mergeParams: true });
  const controller = new BookCopiesController(new BookCopiesService(repository));
  const localAdmin = developmentLoopbackOnly(environment);
  router.use((req, res, next) => {
    if (['POST', 'PATCH', 'DELETE'].includes(req.method)) localAdmin(req, res, next);
    else next();
  });
  router.use(json({ limit: '100kb' }));
  router.get('/', controller.list);
  router.get('/:copyId', controller.getById);
  router.post('/', controller.create);
  router.patch('/:copyId', controller.update);
  router.delete('/:copyId', controller.delete);
  return router;
}
