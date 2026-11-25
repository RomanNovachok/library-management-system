import type { BookCopy, DamageOutcome, Rental } from '../../generated/prisma/client.js';
import { ApiError } from '../../lib/api-error.js';
import { assertCopyCondition } from '../book-copies/copy-condition.js';
import type { CopyConditionData, Inspection } from '../book-copies/copy-condition.js';
import type { ReturnPreviewInput } from './rentals.schemas.js';

export function conditionForIssue(copy: CopyConditionData, inspection: Inspection | undefined): CopyConditionData {
  if (copy.condition === 'UNKNOWN') {
    if (!inspection) throw new ApiError(409, 'COPY_INSPECTION_REQUIRED', 'Спочатку зафіксуйте фізичний стан примірника');
    const result = { condition: inspection.condition, conditionNotes: inspection.conditionNotes ?? null };
    assertCopyCondition(result, 'RENTED');
    return result;
  }
  if (inspection) throw new ApiError(409, 'COPY_INSPECTION_CONFLICT', 'Стан примірника вже зафіксовано');
  const { condition, conditionNotes } = copy;
  assertCopyCondition({ condition, conditionNotes }, 'RENTED');
  return { condition, conditionNotes };
}

type ReturnCondition = {
  ruleCode: 'NONE' | 'MINOR' | 'MAJOR' | 'LOST';
  copyStatus: DamageOutcome;
  condition: BookCopy['condition'];
  conditionNotes: string | null;
  newDamageNotes: string | null;
};

export function conditionForReturn(
  rental: Pick<Rental, 'conditionAtIssue' | 'conditionNotesAtIssue'>,
  { assessment, copyStatus }: ReturnPreviewInput,
): ReturnCondition {
  const before = rental.conditionAtIssue;
  const oldNotes = rental.conditionNotesAtIssue;
  let result: Omit<ReturnCondition, 'copyStatus'>;
  switch (assessment.type) {
    case 'LOST':
      result = { ruleCode: 'LOST', condition: 'LOST', conditionNotes: oldNotes, newDamageNotes: null };
      break;
    case 'UNCHANGED': {
      if (before ? assessment.inspection !== undefined : !assessment.inspection) {
        throw new ApiError(400, 'RENTAL_RETURN_INSPECTION_INVALID', 'Огляд без нових пошкоджень потрібен лише для прокату без початкового знімка');
      }
      result = {
        ruleCode: 'NONE', condition: before ?? assessment.inspection!.condition,
        conditionNotes: before ? oldNotes : assessment.inspection?.conditionNotes ?? null, newDamageNotes: null,
      };
      break;
    }
    case 'DAMAGED':
      if ((before && assessment.existingDamageNotes !== undefined)
        || (assessment.severity === 'MAJOR' && assessment.condition !== 'MAJOR_DAMAGE')) {
        throw new ApiError(400, 'RENTAL_RETURN_CONDITION_INVALID', 'Опис має зберігати відомі пошкодження, а загальний стан має враховувати тяжкість нових');
      }
      result = {
        ruleCode: assessment.severity, condition: assessment.condition, newDamageNotes: assessment.newDamageNotes,
        conditionNotes: [oldNotes ?? assessment.existingDamageNotes, assessment.newDamageNotes].filter(Boolean).join('\n'),
      };
      break;
  }
  if (copyStatus && result.condition !== 'MINOR_DAMAGE') {
    throw new ApiError(400, 'RENTAL_COPY_OUTCOME_INVALID', 'Вибір доступності можливий лише за незначного загального пошкодження');
  }
  const status = result.condition === 'LOST' ? 'LOST' : result.condition === 'MAJOR_DAMAGE' ? 'MAINTENANCE' : copyStatus ?? 'AVAILABLE';
  assertCopyCondition(result, status);
  return { ...result, copyStatus: status };
}
