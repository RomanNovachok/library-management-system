import { useState } from 'react';
import type { DamageRule } from '../../api/rental-contract';
import { createCategory, updateCategory, updateDamageRule, type AdminReaderCategory } from '../../api/settings';
import { useMutation } from '../../hooks/useMutation';
import { damageRuleExplanation, hasEditableDamageRate, normalizeSettingName, parseSettingPercent, settingNameLimit } from '../../utils/settings-forms';
import { Modal } from '../Modal';
import { FormActions, FormFeedback } from './FormFeedback';

export type SettingsDialog = { kind: 'create' } | { kind: 'category'; category: AdminReaderCategory } | { kind: 'rule'; rule: DamageRule };

export function SettingsForm({ dialog, onClose, onRefresh, onSaved }: {
  dialog: SettingsDialog; onClose: () => void; onRefresh: () => void; onSaved: () => void;
}) {
  const { run, pending, error } = useMutation();
  const [validation, setValidation] = useState('');
  const rule = dialog.kind === 'rule' ? dialog.rule : undefined;
  const category = dialog.kind === 'category' ? dialog.category : undefined;
  const currentName = rule?.label ?? category?.name ?? '';
  const currentPercent = rule?.penaltyPercent ?? category?.discountPercent ?? '0.00';
  const editableRate = !rule || hasEditableDamageRate(rule.code);
  const title = rule ? 'Редагувати правило штрафу' : category ? 'Редагувати категорію' : 'Додати категорію';

  return <Modal title={title} pending={pending} onClose={onClose}>
    <form onChange={() => setValidation('')} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const name = normalizeSettingName(String(form.get('name') ?? ''));
      const percent = editableRate ? parseSettingPercent(String(form.get('percent') ?? '')) : currentPercent;
      if (!name || name.length > settingNameLimit || /\p{Cc}/u.test(name)) {
        setValidation(`Укажіть назву завдовжки від 1 до ${settingNameLimit} символів.`);
        return;
      }
      if (percent === undefined) {
        setValidation('Укажіть відсоток від 0 до 100, до двох цифр після коми.');
        return;
      }
      if (dialog.kind === 'create') {
        void run((signal) => createCategory({ name, discountPercent: percent }, signal), onSaved);
        return;
      }
      if (name === currentName && percent === currentPercent) { onClose(); return; }
      if (dialog.kind === 'category') {
        void run((signal) => updateCategory(dialog.category.id, {
          ...(name !== currentName && { name }), ...(percent !== currentPercent && { discountPercent: percent }),
        }, signal), onSaved);
      } else {
        void run((signal) => updateDamageRule(dialog.rule.id, {
          ...(name !== currentName && { label: name }), ...(percent !== currentPercent && { penaltyPercent: percent }),
        }, signal), onSaved);
      }
    }}>
      <FormFeedback error={error} onRefresh={onRefresh} />
      {validation && <p role="alert" className="mb-4 text-sm text-rose-900">{validation}</p>}
      <fieldset disabled={pending} className="grid gap-4">
        <label className="grid gap-2 text-sm font-medium">{rule ? 'Назва правила' : 'Назва категорії'}
          <input className="form-input" name="name" defaultValue={currentName} required maxLength={settingNameLimit} />
        </label>
        <label className="grid gap-2 text-sm font-medium">{rule ? 'Відсоток штрафу' : 'Відсоток знижки'}
          <input className="form-input" name="percent" inputMode="decimal" defaultValue={currentPercent.replace('.', ',')}
            disabled={!editableRate} required={editableRate} />
        </label>
      </fieldset>
      {category && <p className="mt-4 text-sm text-muted">Зміна знижки застосовуватиметься до нових прокатів. Умови вже оформлених прокатів залишаться незмінними.</p>}
      {rule && !editableRate && <p className="mt-4 text-sm text-muted">{damageRuleExplanation(rule.code)}</p>}
      <FormActions pending={pending} error={error} submitLabel="Зберегти" onCancel={onClose} />
    </form>
  </Modal>;
}
