import { json, Router } from 'express';
import type { ApiDependencies } from '../../app.js';
import { requireRole } from '../../middleware/staff-auth.js';
import { AuditLogSubscriber, RentalEventPublisher } from './rental-events.js';
import { RentalsController } from './rentals.controller.js';
import { PrismaRentalsRepository } from './rentals.repository.js';
import { RentalsService } from './rentals.service.js';

export function createRentalsRouter({ rentalsRepository, rentalEvents, now }: ApiDependencies) {
  const router = Router();
  const events = rentalEvents ?? new RentalEventPublisher();
  if (!rentalEvents) events.subscribe(new AuditLogSubscriber());
  const controller = new RentalsController(new RentalsService(rentalsRepository ?? new PrismaRentalsRepository(), events, now));
  const body = json({ limit: '128kb' });
  router.use(['/rentals', '/damage-rules'], requireRole('ADMIN', 'LIBRARIAN'));
  router.get('/rentals', controller.list);
  router.get('/rentals/:id', controller.details);
  router.post('/rentals', body, controller.issue);
  router.get('/damage-rules', controller.damageRules);
  router.post('/rentals/:id/return-preview', body, controller.preview);
  router.post('/rentals/:id/close', body, controller.close);
  return router;
}
