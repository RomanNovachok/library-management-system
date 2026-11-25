import { Router } from 'express';
import type { ApiDependencies } from '../../app.js';
import { requireRole } from '../../middleware/staff-auth.js';
import { ReportsController } from './reports.controller.js';
import { PrismaReportsRepository } from './reports.repository.js';
import { ReportService } from './reports.service.js';

export function createReportsRouter({ reportsRepository, now }: ApiDependencies) {
  const router = Router();
  const controller = new ReportsController(new ReportService(reportsRepository ?? new PrismaReportsRepository(), now));
  router.use(['/reports', '/dashboard'], requireRole('ADMIN', 'LIBRARIAN'));
  router.get('/reports/inventory', controller.inventory);
  router.get('/reports/rentals', controller.rentals);
  router.get('/reports/financial', controller.financial);
  router.get('/dashboard', controller.dashboard);
  return router;
}
