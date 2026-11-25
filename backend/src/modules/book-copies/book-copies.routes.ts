import { json, Router } from 'express';
import { requireRole } from '../../middleware/staff-auth.js';
import { BookCopiesController } from './book-copies.controller.js';
import { PrismaBookCopiesRepository } from './book-copies.repository.js';
import type { BookCopiesRepository } from './book-copies.repository.js';
import { BookCopiesService } from './book-copies.service.js';

export function createBookCopiesRouter(repository: BookCopiesRepository = new PrismaBookCopiesRepository()) {
  const router = Router({ mergeParams: true });
  const controller = new BookCopiesController(new BookCopiesService(repository));
  const admin = requireRole('ADMIN');
  const body = json({ limit: '100kb' });
  router.get('/', controller.list);
  router.get('/:copyId', controller.getById);
  router.post('/', admin, body, controller.create);
  router.patch('/:copyId', admin, body, controller.update);
  router.delete('/:copyId', admin, body, controller.delete);
  return router;
}
