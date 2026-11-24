import { useCallback, useState } from 'react';
import type { Reader, ReaderInput } from '../../api/reader-contract';
import { createReader, getReaderCategories, updateReader } from '../../api/readers';
import { useApiResource } from '../../hooks/useApiResource';
import { useMutation } from '../../hooks/useMutation';
import { validateReaderInput } from '../../utils/reader-forms';
import { ErrorState, LoadingState } from '../ApiFeedback';
import { Modal } from '../Modal';
import { FormActions, FormFeedback } from './FormFeedback';

export function ReaderForm({ reader, onClose, onSaved, onRefresh }: {
  reader?: Reader; onClose: () => void; onSaved: (reader: Reader) => void; onRefresh: () => void;
}) {
  const [values, setValues] = useState<ReaderInput>(() => ({ fullName: reader?.fullName ?? '', address: reader?.address ?? '', phone: reader?.phone ?? '', categoryId: reader?.categoryId ?? '' }));
  const [errors, setErrors] = useState<Partial<Record<keyof ReaderInput, string>>>({});
  const load = useCallback((signal: AbortSignal) => getReaderCategories(signal), []);
  const { resource, retry } = useApiResource(load);
  const { run, pending, error } = useMutation();
  return <Modal title={reader ? 'Редагувати профіль' : 'Додати читача'} pending={pending} onClose={onClose}>
    {resource.status === 'loading' && <LoadingState message="Завантажуємо категорії…" />}
    {resource.status === 'error' && <ErrorState error={resource.error} retry={retry} title="Не вдалося завантажити категорії" />}
    {resource.status === 'success' && <form noValidate onSubmit={(event) => {
      event.preventDefault();
      const result = validateReaderInput(values, resource.data);
      setErrors(result.errors);
      if (!result.data) {
        const form = event.currentTarget;
        requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      const input = result.data;
      const patch = reader ? Object.fromEntries(Object.entries(input).filter(([key, value]) => reader[key as keyof ReaderInput] !== value)) : input;
      if (reader && Object.keys(patch).length === 0) { onClose(); return; }
      void run((signal) => reader ? updateReader(reader.id, patch, signal) : createReader(input, signal), onSaved);
    }}>
      <FormFeedback error={error} onRefresh={onRefresh} />
      {resource.data.length === 0 && <p role="alert" className="mb-4 text-sm text-amber-900">Категорій немає. Реєстрація недоступна до налаштування довідника.</p>}
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        {([{ name: 'fullName', label: 'ПІБ', max: 200 }, { name: 'address', label: 'Адреса', max: 500 }, { name: 'phone', label: 'Телефон', max: 30 }] as const).map(({ name, label, max }) => <div key={name}>
          <label htmlFor={`reader-${name}`} className="mb-2 block text-sm font-medium">{label}</label>
          <input id={`reader-${name}`} name={name} type={name === 'phone' ? 'tel' : 'text'} required maxLength={max} autoComplete="off" className="form-input"
            value={values[name]} onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
            aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `reader-${name}-error` : name === 'phone' ? 'reader-phone-hint' : undefined} />
          {errors[name] && <p id={`reader-${name}-error`} role="alert" className="mt-2 text-xs text-rose-800">{errors[name]}</p>}
        </div>)}
        <p id="reader-phone-hint" className="text-xs leading-5 text-muted">7–15 цифр. Дозволені пробіли, дужки, дефіс, крапка та + на початку.</p>
        <div><label htmlFor="reader-categoryId" className="mb-2 block text-sm font-medium">Категорія</label>
          <select id="reader-categoryId" name="categoryId" required className="form-input" value={values.categoryId}
            onChange={(event) => setValues((current) => ({ ...current, categoryId: event.target.value }))} aria-invalid={Boolean(errors.categoryId)} aria-describedby={errors.categoryId ? 'reader-categoryId-error' : undefined}>
            <option value="">Виберіть категорію</option>
            {resource.data.map((category) => <option key={category.id} value={category.id}>{category.name} — знижка {category.discountPercent.replace('.', ',')}%</option>)}
          </select>
          {errors.categoryId && <p id="reader-categoryId-error" role="alert" className="mt-2 text-xs text-rose-800">{errors.categoryId}</p>}
        </div>
      </fieldset>
      {resource.data.length > 0 && <FormActions pending={pending} error={error} submitLabel={reader ? 'Зберегти зміни' : 'Зареєструвати читача'} onCancel={onClose} />}
    </form>}
  </Modal>;
}
