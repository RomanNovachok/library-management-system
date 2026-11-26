import cors from 'cors';
import express from 'express';
import type { Env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { createApiRouter } from './routes/index.js';
import type { BooksRepository } from './modules/books/books.repository.js';
import type { BookCopiesRepository } from './modules/book-copies/book-copies.repository.js';
import type { ReadersRepository } from './modules/readers/readers.repository.js';
import type { AuthRepository } from './modules/auth/auth.repository.js';
import type { RentalsRepository } from './modules/rentals/rentals.repository.js';
import type { RentalEventPublisher } from './modules/rentals/rental-events.js';
import type { ReportsRepository } from './modules/reports/reports.repository.js';
import type { SettingsRepository } from './modules/settings/settings.repository.js';

export type ApiConfig = Pick<Env, 'CORS_ORIGIN'> &
  Partial<Pick<Env, 'NODE_ENV' | 'SESSION_TTL_SECONDS' | 'SESSION_COOKIE_SAME_SITE' | 'LOGIN_BEHIND_PROXY'>>;

export interface ApiDependencies {
  booksRepository?: BooksRepository;
  bookCopiesRepository?: BookCopiesRepository;
  readersRepository?: ReadersRepository;
  authRepository?: AuthRepository;
  rentalsRepository?: RentalsRepository;
  rentalEvents?: RentalEventPublisher;
  reportsRepository?: ReportsRepository;
  settingsRepository?: SettingsRepository;
  checkReadiness?: () => Promise<void>;
  now?: () => Date;
}

export function createApp(
  config: ApiConfig,
  dependencies: ApiDependencies = {},
) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(cors({
    origin: [config.CORS_ORIGIN],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Library-Request', 'X-Rental-Terms'],
  }));
  app.use('/api', createApiRouter(config, dependencies));
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
