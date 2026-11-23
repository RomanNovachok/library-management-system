import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { archiveBook, deleteBookCopy, getBook, getBookCopies } from '../api/books';
import type { BookCopy } from '../api/book-contract';
import { ApiError } from '../api/client';
import { ErrorState, LoadingState } from '../components/ApiFeedback';
import { CopyStatusBadge } from '../components/CopyStatusBadge';
import { Icon } from '../components/Icon';
import { BookForm } from '../components/forms/BookForm';
import { CopyForm } from '../components/forms/CopyForm';
import { ConfirmAction } from '../components/forms/ConfirmAction';
import { useApiResource } from '../hooks/useApiResource';
import { formatHryvnia } from '../utils/money';

export function BookDetailsPage() {
  const { id = '' } = useParams();
  return <BookDetailsContent key={id} id={id} />;
}

type DialogState = { kind: 'editBook' | 'archiveBook' | 'createCopy' } | { kind: 'editCopy' | 'deleteCopy'; copy: BookCopy };

function BookDetailsContent({ id }: { id: string }) {
  const { search } = useLocation();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DialogState>();
  const [notice, setNotice] = useState('');
  const load = useCallback(async (signal: AbortSignal) => {
    const [book, copies] = await Promise.all([getBook(id, signal), getBookCopies(id, signal)]);
    return { book, copies };
  }, [id]);
  const { resource, retry } = useApiResource(load);
  function refresh(message = '') {
    setDialog(undefined);
    setNotice(message);
    retry();
  }
  const notFound = resource.status === 'error' && resource.error instanceof ApiError
    && (resource.error.status === 404 || (resource.error.status === 400 && resource.error.code === 'VALIDATION_ERROR'));

  return <>
    <Link to={{ pathname: '/books', search }} className="mb-7 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-pine hover:underline"><span aria-hidden="true">←</span>Повернутися до каталогу</Link>
    {notice && <p role="status" className="mb-5 rounded-xl border border-line bg-sage p-4 text-sm text-pine">{notice}</p>}
    {resource.status === 'loading' && <><h1 className="sr-only">Деталі книги</h1><LoadingState message="Завантажуємо книгу та примірники…" /></>}
    {resource.status === 'error' && (notFound ? <div className="rounded-3xl border border-line bg-white px-6 py-16 text-center">
      <p className="eyebrow">Помилка 404</p><h1 className="page-title">Книгу не знайдено</h1>
      <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-muted">Перевірте адресу або поверніться до каталогу, щоб обрати інше видання.</p>
    </div> : <><h1 className="sr-only">Деталі книги</h1><ErrorState error={resource.error} retry={retry} title="Не вдалося завантажити книгу" /></>)}
    {resource.status === 'success' && <>
      {dialog?.kind === 'editBook' && <BookForm book={resource.data.book} onClose={() => setDialog(undefined)} onSaved={() => refresh('Зміни книги збережено.')} onRefresh={() => refresh()} />}
      {dialog?.kind === 'archiveBook' && <ConfirmAction title="Архівувати книгу?" label="Архівувати книгу" action={(signal) => archiveBook(id, signal)} onClose={() => setDialog(undefined)} onRefresh={() => refresh()}
        onSuccess={() => { setDialog(undefined); navigate({ pathname: '/books', search }, { replace: true }); }}>
        <p>«{resource.data.book.title}» зникне зі звичайного каталогу. Примірники та історія прокатів збережуться.</p>
        <p className="mt-3">Відновлення книги зараз недоступне.</p>
      </ConfirmAction>}
      {(dialog?.kind === 'createCopy' || dialog?.kind === 'editCopy') && <CopyForm bookId={id} copy={dialog.kind === 'editCopy' ? dialog.copy : undefined} copies={resource.data.copies}
        onClose={() => setDialog(undefined)} onSaved={() => refresh(dialog.kind === 'editCopy' ? 'Зміни примірника збережено.' : 'Примірник додано.')} onRefresh={() => refresh()} />}
      {dialog?.kind === 'deleteCopy' && <ConfirmAction title="Видалити примірник?" label="Видалити примірник" action={(signal) => deleteBookCopy(id, dialog.copy.id, signal)} onClose={() => setDialog(undefined)} onRefresh={() => refresh()}
        onSuccess={() => refresh('Примірник видалено.')}>
        <p>Примірник «{dialog.copy.inventoryCode}» буде видалено без можливості відновлення.</p>
        <p className="mt-3">Дозволено видалення лише доступного примірника без історії прокатів. Ці умови остаточно перевірить сервер.</p>
      </ConfirmAction>}
      <section className="rounded-3xl border border-line bg-white p-6 sm:p-8">
        <span className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-sage text-pine"><Icon name="books" className="size-7" /></span>
        <p className="eyebrow">Деталі видання</p>
        <h1 className="page-title break-words">{resource.data.book.title}</h1>
        <p className="mt-3 break-words text-base leading-7 text-muted">{resource.data.book.author}</p>
        <p className="mt-4 inline-block max-w-full break-words rounded-lg bg-sage px-3 py-1.5 text-xs font-medium text-pine">{resource.data.book.genre}</p>
        {resource.data.book.archivedAt !== null && <p className="mt-4 text-sm text-amber-900">Архівне видання</p>}
        {resource.data.book.archivedAt === null ? <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="button-secondary" onClick={() => setDialog({ kind: 'editBook' })}>Редагувати</button>
          <button type="button" className="button-danger" onClick={() => setDialog({ kind: 'archiveBook' })}>Архівувати</button>
        </div> : <p className="mt-3 text-sm text-muted">Керування архівною книгою та її примірниками недоступне.</p>}
        <dl className="mt-7 grid gap-6 border-t border-line pt-6 sm:grid-cols-2">
          <div><dt className="text-sm text-muted">Ціна прокату за добу</dt><dd className="mt-2 wrap-anywhere text-2xl font-semibold tracking-tight text-ink">{formatHryvnia(resource.data.book.dailyPrice)}</dd></div>
          <div><dt className="text-sm text-muted">Застава</dt><dd className="mt-2 wrap-anywhere text-2xl font-semibold tracking-tight text-ink">{formatHryvnia(resource.data.book.depositAmount)}</dd></div>
        </dl>
      </section>
      <p className="mt-4 text-xs leading-5 text-muted">Форми керування призначені лише для локальної розробки. Дозвіл на зміну перевіряє сервер.</p>

      <section aria-labelledby="copies-title" className="mt-8 overflow-hidden rounded-3xl border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-6 sm:px-8">
          <h2 id="copies-title" className="text-lg font-semibold tracking-tight text-ink">Фізичні примірники</h2>
          <p className="text-sm text-muted">Усього: <span className="font-medium text-ink">{resource.data.copies.length}</span></p>
          <p className="text-sm text-muted">Доступно: <span className="font-medium text-ink">{resource.data.copies.filter((copy) => copy.status === 'AVAILABLE').length}</span></p>
          {resource.data.book.archivedAt === null && <button type="button" className="button-primary" onClick={() => setDialog({ kind: 'createCopy' })}>Додати примірник</button>}
        </div>
        {resource.data.copies.length === 0 ? <p className="px-6 py-12 text-center text-sm leading-7 text-muted">Для цієї книги ще немає фізичних примірників.</p>
          : <ul className="divide-y divide-line">
            {resource.data.copies.map((copy) => <li key={copy.id} className="flex flex-col items-start justify-between gap-3 px-6 py-5 sm:flex-row sm:items-center sm:px-8">
              <div className="min-w-0"><p className="mb-1 text-xs text-muted">Інвентарний номер</p><p className="break-words text-sm font-semibold text-ink">{copy.inventoryCode}</p></div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <CopyStatusBadge status={copy.status} />
                {resource.data.book.archivedAt === null && <>
                  <button type="button" className="button-secondary" aria-label={`Редагувати примірник ${copy.inventoryCode}`} onClick={() => setDialog({ kind: 'editCopy', copy })}>Редагувати</button>
                  {copy.status === 'AVAILABLE' && <button type="button" className="button-danger" aria-label={`Видалити примірник ${copy.inventoryCode}`} onClick={() => setDialog({ kind: 'deleteCopy', copy })}>Видалити</button>}
                </>}
              </div>
            </li>)}
          </ul>}
      </section>
    </>}
  </>;
}
