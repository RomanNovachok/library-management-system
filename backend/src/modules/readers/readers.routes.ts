import { json, Router } from 'express';
import { ReadersController } from './readers.controller.js';
import { PrismaReadersRepository } from './readers.repository.js';
import type { ReadersRepository } from './readers.repository.js';
import { ReadersService } from './readers.service.js';

export function createReadersRouter(repository: ReadersRepository = new PrismaReadersRepository()) {
  const router = Router();
  const controller = new ReadersController(new ReadersService(repository));
  const body = json({ limit: '100kb' });
  router.get('/reader-categories', controller.categories);
  router.get('/readers', controller.list);
  router.get('/readers/:id', controller.getById);
  router.post('/readers', body, controller.create);
  router.patch('/readers/:id', body, controller.update);
  router.get('/readers/:id/rentals', controller.rentals);
  return router;
}
