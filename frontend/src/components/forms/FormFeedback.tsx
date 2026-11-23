import { ApiError } from '../../api/client';

export function FormFeedback({ error, onRefresh }: { error?: Error; onRefresh: () => void }) {
  if (!error) return null;
  return <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
    <p>{error.message}</p>
    <button type="button" onClick={onRefresh} className="mt-3 min-h-11 cursor-pointer rounded-lg px-2 font-semibold underline">Оновити дані</button>
  </div>;
}

export function FormActions({ pending, error, submitLabel, onCancel, danger = false }: {
  pending: boolean; error?: Error; submitLabel: string; onCancel: () => void; danger?: boolean;
}) {
  const uncertain = error instanceof ApiError && error.outcomeUnknown;
  return <div className="mt-6 flex flex-wrap justify-end gap-3">
    <button type="button" className="button-secondary" disabled={pending} onClick={onCancel}>Скасувати</button>
    <button type="submit" className={danger ? 'button-danger' : 'button-primary'} disabled={pending || uncertain}>{pending ? 'Зберігаємо…' : submitLabel}</button>
  </div>;
}
