import { json, Router } from 'express';
import type { ApiConfig, ApiDependencies } from '../app.js';
import { createBooksRouter } from '../modules/books/books.routes.js';
import { createBookCopiesRouter } from '../modules/book-copies/book-copies.routes.js';
import { createReadersRouter } from '../modules/readers/readers.routes.js';
import { createRentalsRouter } from '../modules/rentals/rentals.routes.js';
import { createReportsRouter } from '../modules/reports/reports.routes.js';
import { createSettingsRouter } from '../modules/settings/settings.routes.js';
import { requireAuth, requireCsrf, requireRole } from '../middleware/staff-auth.js';
import { AuthController } from '../modules/auth/auth.controller.js';
import { PrismaAuthRepository } from '../modules/auth/auth.repository.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { StaffController } from '../modules/staff/staff.controller.js';
import { StaffService } from '../modules/staff/staff.service.js';

export function createApiRouter(config: ApiConfig, dependencies: ApiDependencies) {
  const apiRouter = Router();
  const repository = dependencies.authRepository ?? new PrismaAuthRepository();
  const ttl = (config.SESSION_TTL_SECONDS ?? 28800) * 1000;
  const secure = config.NODE_ENV === 'production';
  const cookieName = secure ? '__Secure-library_session' : 'library_session';
  const authService = new AuthService(repository, ttl, dependencies.now);
  const auth = new AuthController(authService, cookieName, {
    httpOnly: true, secure, sameSite: secure ? config.SESSION_COOKIE_SAME_SITE ?? 'lax' : 'lax', path: '/api',
  }, ttl, config.LOGIN_BEHIND_PROXY ?? false);
  const staff = new StaffController(new StaffService(repository, dependencies.now));
  const csrf = requireCsrf(config.CORS_ORIGIN);
  const admin = requireRole('ADMIN');
  const authJson = json({ limit: '8kb' });

  apiRouter.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  apiRouter.get('/ready', async (_req, res) => {
    try {
      const check = dependencies.checkReadiness ?? (async () => {
        const { prisma } = await import('../lib/prisma.js');
        // Verify the deployed schema as well as connectivity.
        await prisma.$queryRaw`SELECT 1 FROM "StaffSession" LIMIT 0`;
      });
      await check();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  apiRouter.post('/auth/login', csrf, authJson, auth.login);
  apiRouter.post('/auth/logout', csrf, auth.logout);

  apiRouter.use(requireAuth(authService, cookieName), csrf);
  apiRouter.get('/auth/me', auth.me);
  apiRouter.post('/auth/change-password', authJson, auth.changePassword);
  apiRouter.get('/staff', admin, staff.list);
  apiRouter.post('/staff', admin, authJson, staff.create);
  apiRouter.patch('/staff/:id', admin, authJson, staff.update);
  apiRouter.post('/staff/:id/reset-password', admin, authJson, staff.resetPassword);
  apiRouter.use('/settings', admin, createSettingsRouter(dependencies.settingsRepository, dependencies.now));
  apiRouter.use('/books/:bookId/copies', createBookCopiesRouter(dependencies.bookCopiesRepository));
  apiRouter.use('/books', createBooksRouter(dependencies.booksRepository));
  apiRouter.use(createReadersRouter(dependencies.readersRepository));
  apiRouter.use(createRentalsRouter(dependencies));
  apiRouter.use(createReportsRouter(dependencies));
  return apiRouter;
}
