import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { getBook, getBooks } from '../../api/books';
import type { BookSummary, InspectedCondition } from '../../api/book-contract';
import { ApiError } from '../../api/client';
import { getReaders } from '../../api/readers';
import type { Reader } from '../../api/reader-contract';
import { issueRental } from '../../api/rentals';
import type { RentalDetails } from '../../api/rental-contract';
import { useApiResource } from '../../hooks/useApiResource';
import { useMutation } from '../../hooks/useMutation';
import { Modal } from '../Modal';
import { FormActions, FormFeedback } from '../forms/FormFeedback';
import { CopyStatusBadge } from '../CopyStatusBadge';
import { ConditionFields } from '../forms/ConditionFields';
import { SearchableSelect } from '../forms/SearchableSelect';
import { conditionLabel } from '../../utils/copy-condition';
import { rentalMoney, rentalPercent } from '../../utils/rental-display';
import { RentalFields } from './RentalFields';

const loadReaders = (query: { search: string; page: number; pageSize: number }, signal: AbortSignal) =>
  getReaders({ ...query, categoryId: '' }, signal);

export function IssueRentalForm({ onClose, onRefresh, onSaved }: {
  onClose: () => void; onRefresh: () => void; onSaved: (rental: RentalDetails) => void;
}) {
  const [reader, setReader] = useState<Reader>();
  const [book, setBook] = useState<BookSummary>();
  const [copyId, setCopyId] = useState('');
  const [condition, setCondition] = useState<InspectedCondition | ''>('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [dateError, setDateError] = useState('');
  const loadBook = useCallback((signal: AbortSignal) => book ? getBook(book.id, signal) : Promise.resolve(null), [book]);
  const currentBook = useApiResource(loadBook);
  const terms = currentBook.resource.status === 'success' && !currentBook.resource.data?.archivedAt ? currentBook.resource.data : null;
  const copies = terms?.copies.filter((copy) => copy.status === 'AVAILABLE') ?? [];
  const copy = copies.find((item) => item.id === copyId);
  const needsInspection = copy?.condition === 'UNKNOWN';
  const inspection = condition && (condition === 'GOOD' || conditionNotes.trim())
    ? { condition, conditionNotes: condition === 'GOOD' ? null : conditionNotes.trim() } : undefined;
  const mutation = useMutation();
  const reloadRequired = mutation.error instanceof ApiError
    && (mutation.error.outcomeUnknown || [404, 409].includes(mutation.error.status ?? 0));
  const dismiss = reloadRequired ? onRefresh : onClose;

  return <Modal title="Видати книгу" pending={mutation.pending} onClose={dismiss}>
    <FormFeedback error={mutation.error} onRefresh={onRefresh} />
    <form onSubmit={(event) => {
      event.preventDefault();
      const due = new Date(dueAt);
      if (!Number.isFinite(due.getTime()) || due <= new Date()) {
        setDateError('Вкажіть майбутні дату й час повернення.');
        return;
      }
      if (!reader || !terms || !copy || !confirmed || reloadRequired || (needsInspection && !inspection)) return;
      void mutation.run((signal) => issueRental({
        readerId: reader.id, copyId, dueAt: due.toISOString(), ...(needsInspection && inspection && { inspection }),
      }, {
        dailyPrice: terms.dailyPrice, depositAmount: terms.depositAmount,
        categoryName: reader.category.name, discountPercent: reader.category.discountPercent,
        condition: copy.condition, conditionNotes: copy.conditionNotes,
      }, signal), onSaved);
    }}>
      <fieldset disabled={mutation.pending || reloadRequired} className="space-y-5">
        <SearchableSelect label="Читач" placeholder="ПІБ або телефон" value={reader} onChange={(value) => { setReader(value); setConfirmed(false); }}
          load={loadReaders} format={(value) => `${value.fullName} · ${value.phone}`} />
        <SearchableSelect label="Книга" placeholder="Назва, автор або жанр" value={book} onChange={(value) => { setBook(value); setCopyId(''); setCondition(''); setConditionNotes(''); setConfirmed(false); }}
          load={getBooks} unavailable={(value) => value.availableCopyCount === 0}
          format={(value) => `${value.title} · ${value.author} · доступно ${value.availableCopyCount}`} />
        {book && currentBook.resource.status === 'loading' && <p role="status" className="text-sm text-muted">Завантажуємо примірники…</p>}
        {currentBook.resource.status === 'error' && <FormFeedback error={currentBook.resource.error} onRefresh={currentBook.retry} />}
        {book && currentBook.resource.status === 'success' && copies.length === 0 && <p role="status" className="text-sm text-amber-900">Доступних примірників цієї книги немає.</p>}
        <label className="block text-sm font-medium">Примірник
          <select className="form-input mt-2" value={copyId} required disabled={copies.length === 0} onChange={(event) => {
            setCopyId(event.target.value); setCondition(''); setConditionNotes(''); setConfirmed(false);
          }}>
            <option value="">Виберіть інвентарний номер</option>
            {copies.map((copy) => <option key={copy.id} value={copy.id}>{copy.inventoryCode} · {conditionLabel(copy.condition)}</option>)}
          </select>
        </label>
        {copy && <div className="space-y-3 rounded-2xl border border-line p-4">
          <RentalFields fields={[
            ['Доступність', <CopyStatusBadge status={copy.status} />],
            ['Фізичний стан', conditionLabel(copy.condition)],
            ...(copy.conditionNotes ? [['Наявні пошкодження', <span className="whitespace-pre-wrap">{copy.conditionNotes}</span>] as [string, ReactNode]] : []),
          ]} />
          {needsInspection && <>
            <p className="text-sm text-amber-950">Огляньте примірник перед видачею. Якщо він потребує ремонту, передайте його адміністратору.</p>
            <ConditionFields condition={condition} notes={conditionNotes} allowMajor={false}
              onCondition={(value) => { setCondition(value); setConfirmed(false); }} onNotes={(value) => { setConditionNotes(value); setConfirmed(false); }} />
          </>}
        </div>}
        <label className="block text-sm font-medium">Очікувана дата й час повернення
          <input className="form-input mt-2" type="datetime-local" value={dueAt} required
            aria-invalid={Boolean(dateError)} aria-describedby={dateError ? 'rental-due-error' : undefined}
            onChange={(event) => { setDueAt(event.target.value); setDateError(''); }} />
        </label>
        {dateError && <p id="rental-due-error" role="alert" className="text-sm text-rose-800">{dateError}</p>}
        {terms && reader && copyId && <div className="rounded-2xl border border-line p-4">
          <RentalFields fields={[
            ['Ціна за добу', rentalMoney(terms.dailyPrice)], ['Знижка', rentalPercent(reader.category.discountPercent)],
            ['Категорія', reader.category.name], ['Застава', rentalMoney(terms.depositAmount)],
          ]} />
          <label className="mt-4 flex items-start gap-3 text-sm font-medium">
            <input type="checkbox" required className="mt-0.5 size-4 accent-pine" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            {terms.depositAmount === '0.00' ? 'Підтверджую видачу без застави' : 'Підтверджую отримання застави'}
          </label>
        </div>}
      </fieldset>
      <FormActions pending={mutation.pending} disabled={!confirmed || reloadRequired || !dueAt || !terms || !reader || !copy || (needsInspection && !inspection)}
        error={mutation.error} onCancel={dismiss} submitLabel="Підтвердити видачу" />
    </form>
  </Modal>;
}
