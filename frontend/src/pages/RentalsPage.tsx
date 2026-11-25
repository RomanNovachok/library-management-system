import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getRentals } from '../api/rentals';
import { isRentalStatus, rentalStatuses } from '../api/rental-contract';
import type { RentalDetails } from '../api/rental-contract';
import { uuid } from '../api/reader-contract';
import { ErrorState, LoadingState } from '../components/ApiFeedback';
import { Pagination } from '../components/Pagination';
import { IssueRentalForm } from '../components/rentals/IssueRentalForm';
import { RentalStatusBadge } from '../components/rentals/RentalStatusBadge';
import { useApiResource } from '../hooks/useApiResource';
import { positivePage } from '../utils/reader-forms';
import { rentalDate, rentalMoney, rentalStatusLabels } from '../utils/rental-display';

export function RentalsPage() {
  const [params, setParams] = useSearchParams();
  const search = (params.get('search') ?? '').trim();
  const rawStatus = params.get('status');
  const status = isRentalStatus(rawStatus) ? rawStatus : '';
  const overdue = params.get('overdue') === 'true';
  const rawBookId = params.get('bookId');
  const bookId = uuid(rawBookId) ? rawBookId : '';
  const page = positivePage(params.get('page'));
  const pageSize = positivePage(params.get('pageSize'), 20, 100);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<RentalDetails>();
  const load = useCallback((signal: AbortSignal) => getRentals({ search, status, overdue, bookId, page, pageSize }, signal), [search, status, overdue, bookId, page, pageSize]);
  const { resource, retry } = useApiResource(load, 250);

  function filter(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      if (key === 'overdue' && value && status !== 'ACTIVE') next.delete('status');
      if (key === 'status' && value && value !== 'ACTIVE') next.delete('overdue');
      next.delete('page');
      return next;
    }, { replace: key === 'search' });
  }

  return <>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="page-title">Прокати</h1>
      <button type="button" className="button-primary" onClick={() => { setIssued(undefined); setIssuing(true); }}>Видати книгу</button>
    </div>
    {issuing && <IssueRentalForm onClose={() => setIssuing(false)} onRefresh={() => { setIssuing(false); retry(); }}
      onSaved={(rental) => { setIssued(rental); setIssuing(false); retry(); }} />}
    {issued && <p role="status" className="mt-5 rounded-xl border border-line bg-sage p-4 text-sm text-pine">
      Книгу видано. Застава {rentalMoney(issued.depositSnapshot)}. <Link className="font-semibold underline" to={{ pathname: `/rentals/${issued.id}`, search: params.toString() }}>Деталі прокату</Link>
    </p>}
    <div className="my-7 grid items-end gap-4 rounded-2xl border border-line bg-white p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-[2fr_1fr_auto_auto]">
      <form role="search" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="rental-search" className="mb-2 block text-sm font-medium">Пошук прокатів</label>
        <input id="rental-search" type="search" className="form-input" maxLength={200} placeholder="Читач, книга або інвентарний номер"
          value={params.get('search') ?? ''} onChange={(event) => filter('search', event.target.value)} />
      </form>
      <label className="block text-sm font-medium">Статус
        <select className="form-input mt-2" value={status} onChange={(event) => filter('status', event.target.value)}>
          <option value="">Усі статуси</option>
          {rentalStatuses.map((item) => <option key={item} value={item}>{rentalStatusLabels[item]}</option>)}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="size-4 accent-pine" checked={overdue}
          onChange={(event) => filter('overdue', event.target.checked ? 'true' : '')} />
        Лише прострочені
      </label>
      <label className="block text-sm font-medium">На сторінці
        <select className="form-input mt-2" value={pageSize} onChange={(event) => filter('pageSize', event.target.value)}>
          {[...new Set([10, 20, 50, pageSize])].sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      {bookId && <button type="button" className="button-secondary justify-self-start" onClick={() => filter('bookId', '')}>Показати прокати всіх книг</button>}
    </div>
    <section aria-label="Список прокатів" aria-busy={resource.status === 'loading'}>
      {resource.status === 'loading' && <LoadingState message="Завантажуємо прокати…" />}
      {resource.status === 'error' && <ErrorState error={resource.error} retry={retry} title="Не вдалося завантажити прокати" />}
      {resource.status === 'success' && <>
        <p role="status" className="mb-4 text-sm text-muted">Знайдено прокатів · {resource.data.pagination.total}</p>
        {!resource.data.data.length ? <div className="rounded-3xl border border-line bg-white px-6 py-14 text-center">
          <h2 className="text-lg font-semibold">{page > 1 ? 'На цій сторінці немає прокатів' : 'Прокатів не знайдено'}</h2>
          {Boolean(search || status || overdue || bookId) && <button type="button" className="button-secondary mt-4" onClick={() => setParams({})}>Скинути фільтри</button>}
        </div> : <ul className="divide-y divide-line rounded-3xl border border-line bg-white">
          {resource.data.data.map((rental) => <li key={rental.id} className="grid gap-3 px-5 py-5 sm:grid-cols-[2fr_1.5fr_auto] sm:items-center sm:px-7">
            <div className="min-w-0">
              <h2 className="break-words font-semibold"><Link className="text-pine hover:underline" to={{ pathname: `/rentals/${rental.id}`, search: params.toString() }}>{rental.copy.book.title}</Link></h2>
              <p className="mt-1 break-words text-sm text-muted">{rental.reader.fullName} · {rental.copy.inventoryCode}</p>
            </div>
            <div className="space-y-1 text-sm text-muted">
              <p>Видано · {rentalDate(rental.issuedAt)}</p>
              <p>Очікується · {rentalDate(rental.dueAt)}</p>
              {rental.closedAt && <p>Закрито · {rentalDate(rental.closedAt)}</p>}
            </div>
            <div><RentalStatusBadge status={rental.status} overdue={rental.overdue} /></div>
          </li>)}
        </ul>}
        <Pagination pagination={resource.data.pagination} params={params} label="Сторінки списку прокатів" />
      </>}
    </section>
  </>;
}
