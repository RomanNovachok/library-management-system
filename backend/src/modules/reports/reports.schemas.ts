import { z } from 'zod';
import { RentalStatus } from '../../generated/prisma/enums.js';
import { paginationSchema } from '../readers/readers.schemas.js';

const text = z.string().trim().min(1).max(1000)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Керувальні символи заборонені');
const timestamp = z.iso.datetime({ offset: true })
  .refine((value) => !/\.\d{4}/.test(value), 'Допустима точність до мілісекунд')
  .transform((value) => new Date(value))
  .refine((value) => Number.isFinite(value.getTime()) && value.getUTCFullYear() >= 1 && value.getUTCFullYear() <= 9999);
const timeZone = z.string().max(100).regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/)
  .refine((value) => {
    try { new Intl.DateTimeFormat('uk', { timeZone: value }); return true; } catch { return false; }
  }, 'Очікується часова зона IANA')
  .transform((value) => {
    const canonical = new Intl.DateTimeFormat('uk', { timeZone: value }).resolvedOptions().timeZone;
    // ICU can return the legacy alias for either spelling. PostgreSQL can ship without that alias.
    return canonical === 'Europe/Kiev' ? 'Europe/Kyiv' : canonical;
  })
  .default('Europe/Kyiv');

const periodFields = { from: timestamp.optional(), to: timestamp.optional(), timeZone };
function validPeriod({ from, to }: { from?: Date | undefined; to?: Date | undefined }) {
  return from === undefined ? to === undefined : to !== undefined && from < to;
}

export const inventoryQuerySchema = paginationSchema.extend({
  search: text.optional(),
  genre: text.optional(),
  archived: z.enum(['all', 'active', 'archived']).default('all'),
});
export const rentalsQuerySchema = paginationSchema.extend({
  ...periodFields,
  dateBy: z.enum(['issuedAt', 'closedAt']).default('issuedAt'),
  search: text.optional(),
  status: z.enum(RentalStatus).optional(),
  overdue: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
}).refine(validPeriod, { path: ['to'], message: 'Вкажіть обидві межі періоду, початок має передувати кінцю' });
export const financialQuerySchema = z.strictObject({
  ...periodFields,
  chargesPage: paginationSchema.shape.page,
  cashPage: paginationSchema.shape.page,
  pageSize: paginationSchema.shape.pageSize,
}).refine(validPeriod, { path: ['to'], message: 'Вкажіть обидві межі періоду, початок має передувати кінцю' });
export const dashboardQuerySchema = z.strictObject({ timeZone });

export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
export type RentalsQuery = z.infer<typeof rentalsQuerySchema>;
export type FinancialQuery = z.infer<typeof financialQuerySchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
