import { useState } from 'react';
import type { BookCopy, CopyUpdateInput } from '../../api/book-contract';
import { createBookCopy, updateBookCopy } from '../../api/books';
import { useMutation } from '../../hooks/useMutation';
import { canChangeCopyStatus, validateCopyInput } from '../../utils/book-forms';
import type { FieldErrors } from '../../utils/book-forms';
import { Modal } from '../Modal';
import { FormActions, FormFeedback } from './FormFeedback';

export function CopyForm({ bookId, copy, copies, onClose, onSaved, onRefresh }: {
  bookId: string; copy?: BookCopy; copies: BookCopy[];
  onClose: () => void; onSaved: () => void; onRefresh: () => void;
}) {
  const [inventoryCode, setInventoryCode] = useState(copy?.inventoryCode ?? '');
  const [status, setStatus] = useState<string>(copy?.status ?? 'AVAILABLE');
  const [errors, setErrors] = useState<FieldErrors<CopyUpdateInput>>({});
  const { run, pending, error } = useMutation();

  return <Modal title={copy ? 'Редагувати примірник' : 'Додати примірник'} pending={pending} onClose={onClose}>
    <form noValidate onSubmit={(event) => {
      event.preventDefault();
      const result = validateCopyInput(inventoryCode, status, copy?.status);
      if (result.data && copies.some((item) => item.id !== copy?.id && item.inventoryCode === result.data?.inventoryCode)) {
        result.errors.inventoryCode = 'Цей інвентарний номер уже використовується.';
        result.data = undefined;
      }
      setErrors(result.errors);
      if (!result.data) return;
      const input = result.data;
      void run((signal) => copy ? updateBookCopy(bookId, copy.id, input, signal) : createBookCopy(bookId, { inventoryCode: input.inventoryCode }, signal), onSaved);
    }}>
      <FormFeedback error={error} onRefresh={onRefresh} />
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <div>
          <label htmlFor="copy-inventoryCode" className="mb-2 block text-sm font-medium">Інвентарний номер</label>
          <input id="copy-inventoryCode" name="inventoryCode" required maxLength={100} value={inventoryCode} onChange={(event) => setInventoryCode(event.target.value)}
            aria-invalid={Boolean(errors.inventoryCode)} aria-describedby={errors.inventoryCode ? 'copy-code-error' : 'copy-code-hint'} className="form-input" />
          {errors.inventoryCode && <p id="copy-code-error" role="alert" className="mt-2 text-xs text-rose-800">{errors.inventoryCode}</p>}
          <p id="copy-code-hint" className="mt-2 text-xs leading-5 text-muted">Номер має бути унікальним у всьому бібліотечному фонді.</p>
        </div>
        {copy && canChangeCopyStatus(copy.status) ? <div>
          <label htmlFor="copy-status" className="mb-2 block text-sm font-medium">Статус</label>
          <select id="copy-status" name="status" value={status} onChange={(event) => setStatus(event.target.value)} className="form-input" aria-invalid={Boolean(errors.status)} aria-describedby="copy-status-hint">
            <option value="AVAILABLE">Доступний</option><option value="MAINTENANCE">На обслуговуванні</option>
          </select>
          <p id="copy-status-hint" className="mt-2 text-xs leading-5 text-muted">Зміна статусу можлива лише без активного прокату.</p>
        </div> : <p className="text-sm leading-6 text-muted">{copy ? 'Для виданого або втраченого примірника можна змінити лише інвентарний номер.' : 'Новий примірник автоматично отримає статус «Доступний».'}</p>}
        {errors.status && <p role="alert" className="text-xs text-rose-800">{errors.status}</p>}
      </fieldset>
      <FormActions pending={pending} error={error} submitLabel={copy ? 'Зберегти зміни' : 'Додати примірник'} onCancel={onClose} />
    </form>
  </Modal>;
}
