import { z } from 'zod';

const text = z.string().trim().min(1).max(1000);
// Decimal(12, 2): at most ten integer digits; never coerce JSON numbers to money.
const money = z.string().regex(
  /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/,
  'Must be a non-negative decimal string, at most 9999999999.99 and two decimal places',
);

export const bookParamsSchema = z.strictObject({ id: z.uuid().transform((id) => id.toLowerCase()) });
export const createBookSchema = z.strictObject({
  title: text,
  author: text,
  genre: text,
  dailyPrice: money,
  depositAmount: money,
});
export const updateBookSchema = createBookSchema.partial().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  'At least one editable field is required',
);

const pageNumber = z.string().regex(/^[1-9]\d{0,6}$/).transform(Number);
export const listBooksSchema = z.strictObject({
  search: text.optional(),
  title: text.optional(),
  author: text.optional(),
  genre: text.optional(),
  page: pageNumber.pipe(z.number().max(1_000_000)).default(1),
  pageSize: pageNumber.pipe(z.number().max(100)).default(20),
  includeArchived: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
});

export type CreateBookInput = z.infer<typeof createBookSchema>;
export type UpdateBookInput = z.infer<typeof updateBookSchema>;
export type ListBooksQuery = z.infer<typeof listBooksSchema>;
