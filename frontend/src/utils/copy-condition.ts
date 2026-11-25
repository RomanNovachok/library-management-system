import type { CopyCondition } from '../api/book-contract';

const labels: Record<CopyCondition, string> = {
  GOOD: 'Без пошкоджень', MINOR_DAMAGE: 'Незначні пошкодження',
  MAJOR_DAMAGE: 'Серйозні пошкодження', LOST: 'Втрачено', UNKNOWN: 'Не зафіксовано',
};

export function conditionLabel(condition: CopyCondition | null) {
  return labels[condition ?? 'UNKNOWN'];
}
