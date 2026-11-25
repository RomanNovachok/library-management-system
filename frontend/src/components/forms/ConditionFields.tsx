import { inspectedConditions } from '../../api/book-contract';
import type { InspectedCondition } from '../../api/book-contract';
import { conditionLabel } from '../../utils/copy-condition';

export function ConditionFields({ condition, notes, onCondition, onNotes, allowMajor = true }: {
  condition: InspectedCondition | ''; notes: string;
  onCondition: (condition: InspectedCondition | '') => void; onNotes: (notes: string) => void; allowMajor?: boolean;
}) {
  return <div className="space-y-3">
    <label className="block text-sm font-medium">Фізичний стан
      <select className="form-input mt-2" value={condition} onChange={(event) => {
        onCondition(inspectedConditions.find((option) => option === event.target.value) ?? '');
      }}>
        <option value="">Виберіть стан</option>
        {inspectedConditions.filter((option) => allowMajor || option !== 'MAJOR_DAMAGE')
          .map((option) => <option key={option} value={option}>{conditionLabel(option)}</option>)}
      </select>
    </label>
    {condition && condition !== 'GOOD' && <label className="block text-sm font-medium">Опис пошкоджень
      <textarea className="form-input mt-2" required rows={3} maxLength={10_000} value={notes} onChange={(event) => onNotes(event.target.value)} />
    </label>}
  </div>;
}
