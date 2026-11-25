import { json, Router } from 'express';
import { requireRole } from '../../middleware/staff-auth.js';
import { BooksController } from './books.controller.js';
import { BooksService } from './books.service.js';
import { PrismaBooksRepository } from './books.repository.js';
import type { BooksRepository } from './books.repository.js';

export function createBooksRouter(repository: BooksRepository = new PrismaBooksRepository()) {
  const router = Router();
  const controller = new BooksController(new BooksService(repository));
  const admin = requireRole('ADMIN');
  const body = json({ limit: '100kb' });
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/', admin, body, controller.create);
  router.patch('/:id', admin, body, controller.update);
  router.delete('/:id', admin, body, controller.archive);
  return router;
}
