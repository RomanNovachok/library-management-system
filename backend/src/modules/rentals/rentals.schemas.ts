import { z } from 'zod';
import { RentalStatus } from '../../generated/prisma/enums.js';
import { paginationSchema } from '../readers/readers.schemas.js';
import { damageNotesSchema, inspectionSchema } from '../book-copies/copy-condition.js';

const uuid = z.uuid().transform((id) => id.toLowerCase());
export const rentalParamsSchema = z.strictObject({ id: uuid });
export const emptyRentalQuery = z.strictObject({});
export const issueTermsVersionSchema = z.string().regex(/^[a-f0-9]{64}$/).optional();
export const listRentalsSchema = paginationSchema.extend({
  status: z.enum(RentalStatus).optional(),
  overdue: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  search: z.string().trim().min(1).max(200)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Керувальні символи заборонені').optional(),
  readerId: uuid.optional(),
  bookId: uuid.optional(),
});
export const issueRentalSchema = z.strictObject({
  readerId: uuid,
  copyId: uuid,
  dueAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  inspection: inspectionSchema.optional(),
});
export const returnPreviewSchema = z.strictObject({
  assessment: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('UNCHANGED'), inspection: inspectionSchema.optional() }),
    z.strictObject({
      type: z.literal('DAMAGED'), severity: z.enum(['MINOR', 'MAJOR']),
      condition: z.enum(['MINOR_DAMAGE', 'MAJOR_DAMAGE']),
      newDamageNotes: damageNotesSchema, existingDamageNotes: damageNotesSchema.optional(),
    }),
    z.strictObject({ type: z.literal('LOST') }),
  ]),
  copyStatus: z.enum(['AVAILABLE', 'MAINTENANCE']).optional(),
});
export const closeRentalSchema = returnPreviewSchema.extend({
  previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ListRentalsQuery = z.infer<typeof listRentalsSchema>;
export type IssueRentalInput = z.infer<typeof issueRentalSchema>;
export type ReturnPreviewInput = z.infer<typeof returnPreviewSchema>;
export type CloseRentalInput = z.infer<typeof closeRentalSchema>;
