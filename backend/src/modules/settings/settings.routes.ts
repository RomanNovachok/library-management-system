import { json, Router } from 'express';
import { SettingsController } from './settings.controller.js';
import { PrismaSettingsRepository, type SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';

export function createSettingsRouter(repository: SettingsRepository = new PrismaSettingsRepository(), now?: () => Date) {
  const router = Router();
  const controller = new SettingsController(new SettingsService(repository, now));
  const body = json({ limit: '8kb' });
  router.get('/reader-categories', controller.readerCategories);
  router.post('/reader-categories', body, controller.createCategory);
  router.patch('/reader-categories/:id', body, controller.updateCategory);
  router.get('/damage-rules', controller.damageRules);
  router.patch('/damage-rules/:id', body, controller.updateDamageRule);
  return router;
}
