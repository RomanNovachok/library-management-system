import { json, Router } from 'express';
import type { Env } from '../../config/env.js';
import { developmentLoopbackOnly } from '../../middleware/development-loopback-only.js';
import { ReadersController } from './readers.controller.js';
import { PrismaReadersRepository } from './readers.repository.js';
import type { ReadersRepository } from './readers.repository.js';
import { ReadersService } from './readers.service.js';

export function createReadersRouter(environment: Env['NODE_ENV'], repository: ReadersRepository = new PrismaReadersRepository()) {
  const router = Router();
  const controller = new ReadersController(new ReadersService(repository));
  router.use(['/readers', '/reader-categories'], (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, developmentLoopbackOnly(environment));
  router.use(json({ limit: '100kb' }));
  router.get('/reader-categories', controller.categories);
  router.get('/readers', controller.list);
  router.get('/readers/:id', controller.getById);
  router.post('/readers', controller.create);
  router.patch('/readers/:id', controller.update);
  router.get('/readers/:id/rentals', controller.rentals);
  return router;
}
