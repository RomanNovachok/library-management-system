import { useCallback, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { getReader, getReaderRentals } from '../api/readers';
import { ApiError } from '../api/client';
import { ErrorState, LoadingState } from '../components/ApiFeedback';
import { Pagination } from '../components/Pagination';
import { ReaderForm } from '../components/forms/ReaderForm';
import { useApiResource } from '../hooks/useApiResource';
import { positivePage } from '../utils/reader-forms';

export function ReaderDetailsPage() {
  const { id = '' } = useParams();
  return <ReaderDetailsContent key={id} id={id} />;
}
function ReaderDetailsContent({ id }: { id: string }) {
  const [params] = useSearchParams();
  const backParams = new URLSearchParams(params);
  backParams.delete('rentalsPage');
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback((signal: AbortSignal) => getReader(id, signal), [id]);
  const { resource, retry } = useApiResource(load);
  const notFound = resource.status === 'error' && resource.error instanceof ApiError && [400, 404].includes(resource.error.status ?? 0);
  return <>
    <Link to={{ pathname: '/readers', search: backParams.toString() }} className="mb-7 inline-flex min-h-11 items-center text-sm font-medium text-pine hover:underline">← Повернутися до читачів</Link>
    {notice && <p role="status" className="mb-5 rounded-xl border border-line bg-sage p-4 text-sm text-pine">{notice}</p>}
    {resource.status === 'loading' && <><h1 className="sr-only">Профіль читача</h1><LoadingState message="Завантажуємо профіль…" /></>}
    {resource.status === 'error' && <><h1 className="page-title mb-5">{notFound ? 'Читача не знайдено' : 'Профіль читача'}</h1><ErrorState error={resource.error} retry={retry} title={notFound ? 'Перевірте адресу або поверніться до списку' : 'Не вдалося завантажити профіль'} /></>}
    {resource.status === 'success' && <>
      {editing && <ReaderForm reader={resource.data} onClose={() => setEditing(false)} onRefresh={() => { setEditing(false); retry(); }} onSaved={() => { setEditing(false); setNotice('Зміни профілю збережено.'); retry(); }} />}
      <section className="rounded-3xl border border-line bg-white p-6 sm:p-8">
        <p className="eyebrow">Профіль читача</p>
        <div className="flex flex-wrap items-start justify-between gap-4"><h1 className="page-title break-words">{resource.data.fullName}</h1>
          <button type="button" className="button-secondary" onClick={() => setEditing(true)}>Редагувати профіль</button>
        </div>
        <dl className="mt-7 grid gap-6 border-t border-line pt-6 sm:grid-cols-2">
          {[
            ['Телефон', resource.data.phone], ['Адреса', resource.data.address],
            ['Категорія', resource.data.category.name], ['Поточна знижка', `${resource.data.category.discountPercent.replace('.', ',')}%`],
          ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd className="mt-2 break-words font-semibold">{value}</dd></div>)}
        </dl>
      </section>
      <p className="mt-4 text-xs leading-5 text-muted">Зміна категорії впливає на поточну знижку. Історичні умови прокатів зберігаються.</p>
      <ReaderRentalHistory id={id} />
    </>}
  </>;
}
function ReaderRentalHistory({ id }: { id: string }) {
  const [params] = useSearchParams();
  const page = positivePage(params.get('rentalsPage'));
  const load = useCallback((signal: AbortSignal) => getReaderRentals(id, { page, pageSize: 10 }, signal), [id, page]);
  const { resource, retry } = useApiResource(load);
  const statuses = { ACTIVE: 'Активний', RETURNED: 'Повернено', LOST: 'Втрачено' };
  const date = (value: string) => new Date(value).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' });
  return <section aria-labelledby="reader-rentals-title" aria-busy={resource.status === 'loading'} className="mt-8 rounded-3xl border border-line bg-white p-6 sm:p-8">
    <h2 id="reader-rentals-title" className="mb-5 text-lg font-semibold">Історія прокатів</h2>
    {resource.status === 'loading' && <LoadingState message="Завантажуємо історію прокатів…" />}
    {resource.status === 'error' && <ErrorState error={resource.error} retry={retry} title="Не вдалося завантажити історію" />}
    {resource.status === 'success' && <>
      {resource.data.data.length === 0 ? <p className="py-8 text-center text-sm leading-7 text-muted">{resource.data.pagination.total > 0 ? 'На цій сторінці немає прокатів. Поверніться на попередню сторінку.' : 'У цього читача ще немає прокатів.'}</p> : <ul className="divide-y divide-line">
        {resource.data.data.map((rental) => <li key={rental.id} className="py-5 first:pt-0">
          <div className="flex flex-wrap justify-between gap-3"><h3 className="break-words font-semibold">{rental.bookTitle}</h3><span className="rounded-lg bg-sage px-3 py-1 text-sm text-pine">{statuses[rental.status]}</span></div>
          <p className="mt-2 break-words text-sm text-muted">Інвентарний номер: {rental.inventoryCode}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted">Видано</dt><dd className="mt-1">{date(rental.issuedAt)}</dd></div>
            <div><dt className="text-muted">Очікуване повернення</dt><dd className="mt-1">{date(rental.dueAt)}</dd></div>
            <div><dt className="text-muted">{rental.status === 'LOST' ? 'Закрито (втрата)' : 'Повернено'}</dt><dd className="mt-1">{rental.closedAt ? date(rental.closedAt) : 'Ще не повернено'}</dd></div>
          </dl>
        </li>)}
      </ul>}
      <Pagination pagination={resource.data.pagination} params={params} pageKey="rentalsPage" label="Сторінки історії прокатів" />
    </>}
  </section>;
}
