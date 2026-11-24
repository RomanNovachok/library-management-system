import { z } from 'zod';

const uuid = z.uuid('Очікується коректний UUID').transform((id) => id.toLowerCase());
const text = (min: number, max: number) => z.string().trim().min(min).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Керувальні символи заборонені');
const page = z.string().regex(/^[1-9]\d{0,6}$/).transform(Number);

export const readerParamsSchema = z.strictObject({ id: uuid });
export const emptyReaderQuerySchema = z.strictObject({});
export const paginationSchema = z.strictObject({
  page: page.pipe(z.number().max(1_000_000)).default(1),
  pageSize: page.pipe(z.number().max(100)).default(20),
});
export const listReadersSchema = paginationSchema.extend({
  search: text(1, 200).optional(),
  categoryId: uuid.optional(),
});
export const createReaderSchema = z.strictObject({
  fullName: text(2, 200),
  address: text(3, 500),
  phone: text(7, 30).regex(/^\+?[0-9 ()\-\.]+$/, 'Допустимі цифри, пробіли, дужки, дефіс, крапка та початковий +')
    .refine((value) => { const digits = value.replace(/\D/g, '').length; return digits >= 7 && digits <= 15; }, 'Телефон має містити від 7 до 15 цифр'),
  categoryId: uuid,
});
export const updateReaderSchema = createReaderSchema.partial().refine(
  (input) => Object.values(input).some((value) => value !== undefined), 'Вкажіть хоча б одне поле для редагування',
);
export type CreateReaderInput = z.infer<typeof createReaderSchema>;
export type UpdateReaderInput = z.infer<typeof updateReaderSchema>;
export type ListReadersQuery = z.infer<typeof listReadersSchema>;
export type PaginationQuery = z.infer<typeof paginationSchema>;
