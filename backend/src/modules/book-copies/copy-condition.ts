import { z } from 'zod';
import type { BookCopy, CopyStatus } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';

export const inspectedConditionSchema = z.enum(['GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE']);
export const damageNotesSchema = z.string().trim().min(1).max(10_000)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'Опис містить недопустимі символи');
export const inspectionSchema = z.strictObject({
  condition: inspectedConditionSchema,
  conditionNotes: damageNotesSchema.nullable().optional(),
});
export type Inspection = z.infer<typeof inspectionSchema>;
export type CopyConditionData = Pick<BookCopy, 'condition' | 'conditionNotes'>;

export function assertCopyCondition({ condition, conditionNotes }: CopyConditionData, status: CopyStatus) {
  if ((condition === 'LOST') !== (status === 'LOST') || (condition === 'MAJOR_DAMAGE' && status !== 'MAINTENANCE')) {
    throw new ApiError(409, 'COPY_CONDITION_STATUS_CONFLICT', 'Фізичний стан несумісний зі статусом доступності');
  }
  if ((condition === 'GOOD' || condition === 'UNKNOWN') && conditionNotes !== null
    || (condition === 'MINOR_DAMAGE' || condition === 'MAJOR_DAMAGE') && !conditionNotes?.trim()) {
    throw new ApiError(400, 'COPY_CONDITION_NOTES_INVALID', 'Для пошкодженого примірника потрібен опис. Для стану без пошкоджень опис має бути порожнім');
  }
}
