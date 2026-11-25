import { z } from 'zod';
import { inspectionSchema } from './copy-condition.js';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const inventoryCode = z.string().trim().min(1).max(100)
  .refine((value) => !value.includes('\0'), 'Inventory code must not contain null characters');
export const copyStatusSchema = z.enum(['AVAILABLE', 'RENTED', 'MAINTENANCE', 'LOST']);
export const bookCopiesParamsSchema = z.strictObject({ bookId: uuid });
export const bookCopyParamsSchema = bookCopiesParamsSchema.extend({ copyId: uuid });
export const listBookCopiesSchema = z.strictObject({ status: copyStatusSchema.optional() });
export const emptyCopyQuerySchema = z.strictObject({});
export const createBookCopySchema = inspectionSchema.extend({ inventoryCode }).partial({ condition: true });
export const updateBookCopySchema = createBookCopySchema.partial().extend({
  status: copyStatusSchema.optional(),
}).refine((value) => Object.values(value).some((field) => field !== undefined), 'At least one editable field is required');

export type CreateBookCopyInput = z.infer<typeof createBookCopySchema>;
export type UpdateBookCopyInput = z.infer<typeof updateBookCopySchema>;
export type ListBookCopiesQuery = z.infer<typeof listBookCopiesSchema>;
