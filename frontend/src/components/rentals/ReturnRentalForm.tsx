import { useCallback, useMemo, useState } from 'react';
import type { InspectedCondition } from '../../api/book-contract';
import { ApiError } from '../../api/client';
import { closeRental, getDamageRules, getReturnPreview } from '../../api/rentals';
import type { RentalDetails, ReturnInput } from '../../api/rental-contract';
import { useApiResource } from '../../hooks/useApiResource';
import { useMutation } from '../../hooks/useMutation';
import { conditionLabel } from '../../utils/copy-condition';
import { rentalMoney, rentalPercent } from '../../utils/rental-display';
import { CopyStatusBadge } from '../CopyStatusBadge';
import { Modal } from '../Modal';
import { ConditionFields } from '../forms/ConditionFields';
import { FormActions, FormFeedback } from '../forms/FormFeedback';
import { RentalFields } from './RentalFields';

type DamageState = 'MINOR_DAMAGE' | 'MAJOR_DAMAGE';
type Mode = ReturnInput['assessment']['type'] | '';

export function ReturnRentalForm({ rental, onClose, onRefresh, onSaved }: {
  rental: RentalDetails; onClose: () => void; onRefresh: () => void; onSaved: (rental: RentalDetails) => void;
}) {
  const rules = useApiResource(getDamageRules);
  const [mode, setMode] = useState<Mode>('');
  const [severity, setSeverity] = useState<'MINOR' | 'MAJOR' | ''>('');
  const [condition, setCondition] = useState<InspectedCondition | ''>('');
  const [newNotes, setNewNotes] = useState('');
  const [existingNotes, setExistingNotes] = useState('');
  const [copyStatus, setCopyStatus] = useState<'AVAILABLE' | 'MAINTENANCE'>('AVAILABLE');
  const [confirmedVersion, setConfirmedVersion] = useState('');
  const [recalculated, setRecalculated] = useState(false);
  const legacy = rental.conditionAtIssue === null;
  const lost = mode === 'LOST';
  const finalCondition = mode === 'UNCHANGED' && !legacy ? rental.conditionAtIssue : condition;

  const input = useMemo((): ReturnInput | null => {
    const availability = finalCondition === 'MINOR_DAMAGE' ? { copyStatus } : {};
    if (mode === 'LOST') return { assessment: { type: 'LOST' } };
    if (mode === 'UNCHANGED') {
      if (!legacy) return { assessment: { type: 'UNCHANGED' }, ...availability };
      if (!condition || (condition !== 'GOOD' && !existingNotes.trim())) return null;
      return { assessment: { type: 'UNCHANGED', inspection: { condition, conditionNotes: condition === 'GOOD' ? null : existingNotes.trim() } }, ...availability };
    }
    if (mode !== 'DAMAGED' || !severity || !newNotes.trim() || (condition !== 'MINOR_DAMAGE' && condition !== 'MAJOR_DAMAGE')) return null;
    return {
      assessment: { type: 'DAMAGED', severity, condition, newDamageNotes: newNotes.trim(),
        ...(legacy && existingNotes.trim() && { existingDamageNotes: existingNotes.trim() }) },
      ...availability,
    };
  }, [mode, finalCondition, copyStatus, legacy, condition, existingNotes, severity, newNotes]);

  const load = useCallback((signal: AbortSignal) => input ? getReturnPreview(rental.id, input, signal) : Promise.resolve(null), [rental.id, input]);
  const preview = useApiResource(load, 300);
  const quote = preview.resource.status === 'success' ? preview.resource.data : null;
  const previewError = preview.resource.status === 'error' ? preview.resource.error : undefined;
  const mutation = useMutation();
  const stale = mutation.error instanceof ApiError && mutation.error.code === 'RENTAL_PREVIEW_CHANGED' && !recalculated;
  const reloadRequired = mutation.error instanceof ApiError && (mutation.error.outcomeUnknown || mutation.error.status === 404
    || (mutation.error.status === 409 && mutation.error.code !== 'RENTAL_PREVIEW_CHANGED'));
  const refreshRental = previewError instanceof ApiError && ['RENTAL_NOT_FOUND', 'RENTAL_ALREADY_CLOSED', 'RENTAL_COPY_STATE_CONFLICT'].includes(previewError.code ?? '');
  const dismiss = reloadRequired || refreshRental ? onRefresh : onClose;

  function clearConfirmation() {
    setConfirmedVersion(''); setRecalculated(true);
  }
  function selectMode(value: Mode) {
    setMode(value); setCondition(''); setSeverity(''); setNewNotes(''); setExistingNotes(''); setCopyStatus('AVAILABLE');
    clearConfirmation();
  }
  function resetPreview() {
    clearConfirmation(); preview.retry();
  }

  return <Modal title={lost ? 'Оформити втрату книги' : 'Оформити повернення'} pending={mutation.pending} onClose={dismiss}>
    <p className="mb-4 break-words text-sm text-muted">{rental.copy.book.title} · {rental.copy.inventoryCode}</p>
    <div className="mb-4 space-y-2 rounded-2xl border border-line p-4">
      <RentalFields fields={[
        ['Фізичний стан при видачі', conditionLabel(rental.conditionAtIssue)],
        ['Наявні при видачі пошкодження', <span className="whitespace-pre-wrap">{rental.conditionNotesAtIssue ?? (legacy ? 'Не зафіксовано' : 'Немає')}</span>],
      ]} />
      {legacy && <p className="text-sm text-amber-950">Початковий стан не зафіксовано. Нараховуйте штраф лише за пошкодження, які підтверджено як нові.</p>}
    </div>
    {!recalculated && <FormFeedback error={mutation.error} onRefresh={stale ? resetPreview : onRefresh} />}
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!input || !quote || confirmedVersion !== quote.previewVersion || reloadRequired || stale) return;
      setRecalculated(false);
      void mutation.run((signal) => closeRental(rental.id, { ...input, previewVersion: quote.previewVersion }, signal), onSaved);
    }}>
      <fieldset className="space-y-4" disabled={mutation.pending || reloadRequired}>
        <button type="button" className={lost ? 'button-secondary' : 'button-danger'} onClick={() => selectMode(lost ? '' : 'LOST')}>
          {lost ? 'Перейти до повернення' : 'Примірник втрачено'}
        </button>
        {lost ? <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-900">Примірник буде позначено втраченим. До оплати за користування додається компенсація за втрату.</p>
          : <label className="block text-sm font-medium">Чи з’явилися нові пошкодження?
            <select className="form-input mt-2" value={mode} onChange={(event) => selectMode(event.target.value === 'DAMAGED' ? 'DAMAGED' : event.target.value === 'UNCHANGED' ? 'UNCHANGED' : '')}>
              <option value="">Виберіть відповідь</option><option value="UNCHANGED">Ні</option><option value="DAMAGED">Так</option>
            </select>
          </label>}
        {mode === 'UNCHANGED' && legacy && <ConditionFields condition={condition} notes={existingNotes}
          onCondition={(value) => { setCondition(value); clearConfirmation(); }} onNotes={(value) => { setExistingNotes(value); clearConfirmation(); }} />}
        {mode === 'DAMAGED' && <>
          {rules.resource.status === 'loading' && <p role="status" className="text-sm text-muted">Завантажуємо правила пошкоджень…</p>}
          {rules.resource.status === 'error' && <FormFeedback error={rules.resource.error} onRefresh={rules.retry} />}
          {rules.resource.status === 'success' && <label className="block text-sm font-medium">Тяжкість нових пошкоджень
            <select className="form-input mt-2" value={severity} onChange={(event) => {
              const value = event.target.value === 'MAJOR' ? 'MAJOR' : event.target.value === 'MINOR' ? 'MINOR' : '';
              setSeverity(value); setCondition(value === 'MAJOR' ? 'MAJOR_DAMAGE' : ''); clearConfirmation();
            }}>
              <option value="">Виберіть тяжкість</option>
              {rules.resource.data.filter(({ code }) => code === 'MINOR' || code === 'MAJOR').map((rule) =>
                <option key={rule.id} value={rule.code}>{rule.label} · {rentalPercent(rule.penaltyPercent)}</option>)}
            </select>
          </label>}
          <label className="block text-sm font-medium">Загальний фізичний стан після повернення
            <select className="form-input mt-2" value={condition} onChange={(event) => { setCondition(event.target.value as DamageState | ''); clearConfirmation(); }}>
              <option value="">Виберіть стан</option>
              <option value="MINOR_DAMAGE" disabled={severity === 'MAJOR'}>{conditionLabel('MINOR_DAMAGE')}</option>
              <option value="MAJOR_DAMAGE">{conditionLabel('MAJOR_DAMAGE')}</option>
            </select>
          </label>
          <label className="block text-sm font-medium">Опис нових пошкоджень
            <textarea className="form-input mt-2" rows={3} maxLength={10_000} value={newNotes} onChange={(event) => { setNewNotes(event.target.value); clearConfirmation(); }} />
          </label>
          {legacy && <label className="block text-sm font-medium">Інші пошкодження без підтвердженого походження
            <textarea className="form-input mt-2" rows={2} maxLength={10_000} value={existingNotes} onChange={(event) => { setExistingNotes(event.target.value); clearConfirmation(); }} />
          </label>}
        </>}
        {!lost && finalCondition === 'MINOR_DAMAGE' && <label className="block text-sm font-medium">Доступність після повернення
          <select className="form-input mt-2" value={copyStatus} onChange={(event) => {
            setCopyStatus(event.target.value === 'MAINTENANCE' ? 'MAINTENANCE' : 'AVAILABLE'); clearConfirmation();
          }}>
            <option value="AVAILABLE">Доступний до видачі</option><option value="MAINTENANCE">На обслуговуванні</option>
          </select>
        </label>}
        {input && preview.resource.status === 'loading' && <p role="status" className="text-sm text-muted">Розраховуємо суми…</p>}
        {previewError && <FormFeedback error={previewError} onRefresh={refreshRental ? onRefresh : resetPreview} />}
        {quote && <div className="rounded-2xl border border-line p-4">
          <RentalFields fields={[
            ['Фізичний стан після повернення', conditionLabel(quote.condition)], ['Доступність після закриття', <CopyStatusBadge status={quote.copyStatus} />],
            ['Оплачувані дні', quote.billableDays], ['Ставка штрафу', rentalPercent(quote.damagePercent)],
            ['Вартість прокату', rentalMoney(quote.rentalFee)], ['Штраф', rentalMoney(quote.damageFine)], ['Застава', rentalMoney(quote.deposit)],
            ['Повернути читачеві', rentalMoney(quote.refundAmount)], ['Отримати доплату', rentalMoney(quote.additionalPayment)],
          ]} />
          <label className="mt-4 flex items-start gap-3 text-sm font-medium">
            <input type="checkbox" required className="mt-0.5 size-4 accent-pine" checked={confirmedVersion === quote.previewVersion}
              disabled={stale} onChange={(event) => setConfirmedVersion(event.target.checked ? quote.previewVersion : '')} />
            Підтверджую касовий розрахунок
          </label>
        </div>}
      </fieldset>
      <FormActions pending={mutation.pending} disabled={!quote || confirmedVersion !== quote.previewVersion || stale || reloadRequired}
        error={mutation.error} onCancel={dismiss} danger={lost} submitLabel={lost ? 'Підтвердити втрату' : 'Підтвердити повернення'} />
    </form>
  </Modal>;
}
