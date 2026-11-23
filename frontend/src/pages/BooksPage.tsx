import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getBooks } from '../api/books';
import { ErrorState, LoadingState } from '../components/ApiFeedback';
import { Icon } from '../components/Icon';
import { BookForm } from '../components/forms/BookForm';
import type { Book } from '../api/book-contract';
import { useApiResource } from '../hooks/useApiResource';
import { formatHryvnia } from '../utils/money';

export function BooksPage() {
  const [params, setParams] = useSearchParams();
  const searchInput = (params.get('search') ?? '').slice(0, 1000);
  const search = searchInput.trim();
  const pageParam = params.get('page') ?? '1';
  const page = /^[1-9]\d{0,6}$/.test(pageParam) && Number(pageParam) <= 1_000_000 ? Number(pageParam) : 1;
  const sizeParam = Number(params.get('pageSize'));
  const pageSize = [4, 12, 24].includes(sizeParam) ? sizeParam : 12;
  const load = useCallback((signal: AbortSignal) => getBooks({ search, page, pageSize }, signal), [search, page, pageSize]);
  const { resource, retry } = useApiResource(load, 300);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Book>();

  function changeSearch(value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set('search', value);
      else next.delete('search');
      next.delete('page');
      return next;
    }, { replace: true });
  }

  function pageLink(target: number) {
    const next = new URLSearchParams(params);
    if (target === 1) next.delete('page');
    else next.set('page', String(target));
    return { pathname: '/books', search: next.toString() };
  }

  return <>
    <p className="eyebrow">Книжковий фонд</p>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="page-title">Книги</h1>
      <button type="button" className="button-primary" onClick={() => setCreating(true)}>Додати книгу</button>
    </div>
    <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">Знайдіть потрібне видання та перегляньте доступність його примірників.</p>
    <p className="mt-3 text-xs leading-5 text-muted">Керування фондом доступне лише для локальної розробки. Дозвіл на зміну перевіряє сервер.</p>
    {created && <p role="status" className="mt-5 break-words rounded-xl border border-line bg-sage p-4 text-sm leading-6 text-pine">
      Книгу «{created.title}» додано. Каталог відфільтровано за її назвою. <Link to={{ pathname: `/books/${created.id}`, search: params.toString() }} className="font-semibold underline">Переглянути книгу</Link>
    </p>}
    {creating && <BookForm onClose={() => setCreating(false)} onRefresh={() => { setCreating(false); retry(); }} onSaved={(book) => {
      setCreating(false);
      setCreated(book);
      setParams({ search: book.title });
      retry();
    }} />}

    <div className="mb-7 mt-8 flex flex-col gap-4 rounded-2xl border border-line bg-white p-5 sm:flex-row sm:items-end sm:p-6">
      <form role="search" className="min-w-0 flex-1" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="book-search" className="mb-2 block text-sm font-medium text-ink">Пошук книг</label>
        <input id="book-search" type="search" value={searchInput} onChange={(event) => changeSearch(event.target.value)} maxLength={1000}
          placeholder="Назва, автор або жанр" autoComplete="off" aria-describedby="book-search-hint"
          className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-pine" />
        <p id="book-search-hint" className="mt-2 text-xs text-muted">Результати оновлюються під час введення.</p>
      </form>
      <div className="sm:pb-6">
        <label htmlFor="book-page-size" className="mb-2 block text-sm font-medium text-ink">Книг на сторінці</label>
        <select id="book-page-size" value={pageSize} onChange={(event) => {
          const value = event.target.value;
          setParams((current) => {
            const next = new URLSearchParams(current);
            next.set('pageSize', value);
            next.delete('page');
            return next;
          });
        }} className="min-h-12 w-full cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink sm:w-40">
          {[4, 12, 24].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </div>
    </div>

    <section aria-label="Результати пошуку книг" aria-busy={resource.status === 'loading'}>
      {resource.status === 'loading' && <LoadingState message="Завантажуємо каталог…" />}
      {resource.status === 'error' && <ErrorState error={resource.error} retry={retry} title="Не вдалося завантажити каталог" />}
      {resource.status === 'success' && <>
        <p role="status" className="mb-5 text-sm text-muted">Знайдено видань: <span className="font-semibold text-ink">{resource.data.pagination.total}</span></p>
        {resource.data.data.length === 0 ? <div className="rounded-3xl border border-line bg-white px-6 py-14 text-center">
          <span className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-sage text-pine"><Icon name="books" className="size-8" /></span>
          <h2 className="text-xl font-semibold text-ink">{resource.data.pagination.total > 0 ? 'На цій сторінці немає книг' : search ? 'Книг не знайдено' : 'Каталог поки порожній'}</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-muted">{resource.data.pagination.total > 0 ? 'Номер сторінки виходить за межі поточного каталогу.' : search ? 'Спробуйте іншу назву, автора або жанр.' : 'Коли до бібліотечного фонду додадуть видання, вони з’являться тут.'}</p>
          {search && <button type="button" onClick={() => changeSearch('')} className="mt-5 min-h-11 cursor-pointer rounded-xl border border-line px-5 py-3 text-sm font-medium text-pine hover:bg-sage">Очистити пошук</button>}
          {resource.data.pagination.total > 0 && <Link to={pageLink(1)} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-pine px-5 py-3 text-sm font-medium text-white hover:bg-[#245448]">До першої сторінки</Link>}
        </div> : <>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {resource.data.data.map((book) => <li key={book.id} className="min-w-0">
              <Link to={{ pathname: `/books/${book.id}`, search: params.toString() }} aria-label={`Переглянути книгу «${book.title}»`}
                className="group flex h-full flex-col rounded-2xl border border-line bg-white p-6 transition-colors hover:border-pine/35 hover:bg-[#fcfdfb]">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sage text-pine"><Icon name="books" className="size-6" /></span>
                  <span className="min-w-0 break-words rounded-lg bg-surface px-3 py-1.5 text-xs text-muted">{book.genre}</span>
                </div>
                <h2 className="break-words text-lg font-semibold leading-7 tracking-tight text-ink">{book.title}</h2>
                <p className="mb-6 mt-2 break-words text-sm leading-6 text-muted">{book.author}</p>
                <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-4 border-t border-line pt-5 text-sm">
                  <div><dt className="text-xs text-muted">За добу</dt><dd className="mt-1 wrap-anywhere font-semibold text-ink">{formatHryvnia(book.dailyPrice)}</dd></div>
                  <div><dt className="text-xs text-muted">Застава</dt><dd className="mt-1 wrap-anywhere font-semibold text-ink">{formatHryvnia(book.depositAmount)}</dd></div>
                  <div><dt className="text-xs text-muted">Усього примірників</dt><dd className="mt-1 font-semibold text-ink">{book.copyCount}</dd></div>
                  <div><dt className="text-xs text-muted">Доступно</dt><dd className={`mt-1 font-semibold ${book.availableCopyCount > 0 ? 'text-emerald-800' : 'text-muted'}`}>{book.availableCopyCount}</dd></div>
                </dl>
                <span className="mt-6 flex items-center justify-between gap-2 text-sm font-medium text-pine">Переглянути примірники<Icon name="arrow" className="size-4 shrink-0 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" /></span>
              </Link>
            </li>)}
          </ul>
          {resource.data.pagination.totalPages > 1 && <nav aria-label="Сторінки каталогу" className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 text-sm">
            {page > 1 ? <Link to={pageLink(page - 1)} rel="prev" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 py-2 font-medium text-pine hover:bg-sage">← Назад</Link>
              : <span aria-disabled="true" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 py-2 text-muted opacity-50">← Назад</span>}
            <span className="text-muted">Сторінка <span className="font-semibold text-ink">{resource.data.pagination.page}</span> з {resource.data.pagination.totalPages}</span>
            {page < resource.data.pagination.totalPages ? <Link to={pageLink(page + 1)} rel="next" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 py-2 font-medium text-pine hover:bg-sage">Далі →</Link>
              : <span aria-disabled="true" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 py-2 text-muted opacity-50">Далі →</span>}
          </nav>}
        </>}
      </>}
    </section>
  </>;
}
