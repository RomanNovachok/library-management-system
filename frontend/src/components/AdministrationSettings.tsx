import { useState } from 'react';
import { listAdminCategories, listAdminDamageRules } from '../api/settings';
import { useApiResource } from '../hooks/useApiResource';
import { rentalPercent } from '../utils/rental-display';
import { damageRuleExplanation } from '../utils/settings-forms';
import { ErrorState, LoadingState } from './ApiFeedback';
import { SettingsForm, type SettingsDialog } from './forms/SettingsForm';

export function AdministrationSettings({ checkSession }: { checkSession: () => void }) {
  const categories = useApiResource(listAdminCategories);
  const rules = useApiResource(listAdminDamageRules);
  const [dialog, setDialog] = useState<SettingsDialog>();
  const [notice, setNotice] = useState<'category' | 'rule'>();

  function refresh() {
    if (dialog?.kind === 'rule') rules.retry();
    else categories.retry();
    setDialog(undefined);
  }

  return <>
    <section className="mt-6 rounded-3xl border border-line bg-white p-5 sm:p-7" aria-labelledby="reader-categories-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="reader-categories-title" className="text-xl font-semibold">Категорії читачів</h2>
        <button type="button" className="button-primary" onClick={() => setDialog({ kind: 'create' })}>Додати категорію</button>
      </div>
      {notice === 'category' && <p role="status" className="mb-4 text-sm text-pine">Категорію збережено.</p>}
      {categories.resource.status === 'loading' && <LoadingState message="Завантажуємо категорії читачів…" />}
      {categories.resource.status === 'error' && <ErrorState error={categories.resource.error} retry={categories.retry} />}
      {categories.resource.status === 'success' && (categories.resource.data.length === 0
        ? <p className="text-sm text-muted">Категорій ще немає.</p>
        : <ul className="divide-y divide-line">
          {categories.resource.data.map((category) => <li key={category.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="break-words font-medium">{category.name}</p>
              <p className="mt-1 text-sm text-muted">Знижка {rentalPercent(category.discountPercent)} · Читачів {category.readerCount.toLocaleString('uk-UA')}</p>
            </div>
            <button type="button" className="button-secondary" onClick={() => setDialog({ kind: 'category', category })}>Редагувати</button>
          </li>)}
        </ul>)}
    </section>
    <section className="mt-6 rounded-3xl border border-line bg-white p-5 sm:p-7" aria-labelledby="damage-rules-title">
      <h2 id="damage-rules-title" className="text-xl font-semibold">Правила штрафів</h2>
      <p className="my-4 text-sm text-muted">Штраф розраховується від застави, зафіксованої на момент видачі, та залежить від тяжкості нових пошкоджень. Зміна ставки не перераховує завершені прокати.</p>
      {notice === 'rule' && <p role="status" className="mb-4 text-sm text-pine">Правило штрафу збережено.</p>}
      {rules.resource.status === 'loading' && <LoadingState message="Завантажуємо правила штрафів…" />}
      {rules.resource.status === 'error' && <ErrorState error={rules.resource.error} retry={rules.retry} />}
      {rules.resource.status === 'success' && (rules.resource.data.length === 0
        ? <p className="text-sm text-muted">Правила штрафів відсутні. Перевірте початкове наповнення довідника.</p>
        : <ul className="divide-y divide-line">
          {rules.resource.data.map((rule) => <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="break-words font-medium">{rule.label} · {rentalPercent(rule.penaltyPercent)}</p>
              <p className="mt-1 text-sm text-muted">{damageRuleExplanation(rule.code)}</p>
            </div>
            <button type="button" className="button-secondary" onClick={() => setDialog({ kind: 'rule', rule })}>Редагувати</button>
          </li>)}
        </ul>)}
    </section>
    {dialog && <SettingsForm dialog={dialog} onClose={() => setDialog(undefined)} onRefresh={() => {
      checkSession();
      refresh();
    }} onSaved={() => {
      setNotice(dialog.kind === 'rule' ? 'rule' : 'category');
      refresh();
    }} />}
  </>;
}
