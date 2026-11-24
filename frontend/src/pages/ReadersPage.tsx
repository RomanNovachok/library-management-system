import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getReaderCategories, getReaders } from '../api/readers';
import type { Reader } from '../api/reader-contract';
import { ErrorState, LoadingState } from '../components/ApiFeedback';
import { Pagination } from '../components/Pagination';
import { ReaderForm } from '../components/forms/ReaderForm';
import { useApiResource } from '../hooks/useApiResource';
import { readerListQuery } from '../utils/reader-forms';

export function ReadersPage() {
  const [params, setParams] = useSearchParams();
  const { search, categoryId, page, pageSize } = readerListQuery(params);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Reader>();
  const load = useCallback((signal: AbortSignal) => getReaders({ search, categoryId, page, pageSize }, signal), [search, categoryId, page, pageSize]);
  const { resource, retry } = useApiResource(load, 300);
  const categoriesLoad = useCallback((signal: AbortSignal) => getReaderCategories(signal), []);
  const categories = useApiResource(categoriesLoad);
  function change(key: string, value: string, replace = false) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      next.delete('page');
      return next;
    }, { replace });
  }
  return <>
    <p className="eyebrow">Читацькі профілі</p>
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="page-title">Читачі</h1>
      <button type="button" className="button-primary" onClick={() => setCreating(true)}>Додати читача</button>
    </div>
    <p className="mt-3 text-sm leading-7 text-muted">Реєстрація, контактні дані, категорії та історія прокатів читачів.</p>
    <p className="mt-2 text-xs leading-5 text-muted">Персональні дані доступні лише під час локальної розробки. Доступ перевіряє сервер.</p>
    {created && <p role="status" className="mt-5 rounded-xl border border-line bg-sage p-4 text-sm text-pine">Читача зареєстровано. <Link className="font-semibold underline" to={{ pathname: `/readers/${created.id}`, search: params.toString() }}>Переглянути профіль</Link></p>}
    {creating && <ReaderForm onClose={() => setCreating(false)} onRefresh={() => { setCreating(false); retry(); categories.retry(); }} onSaved={(reader) => {
      setCreating(false); setCreated(reader); setParams({ search: reader.fullName }); retry();
    }} />}
    <div className="mb-7 mt-8 grid gap-4 rounded-2xl border border-line bg-white p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-[2fr_2fr_1fr]">
      <form role="search" className="min-w-0" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="reader-search" className="mb-2 block text-sm font-medium">Пошук читачів</label>
        <input id="reader-search" type="search" className="form-input" value={params.get('search') ?? ''} maxLength={200} autoComplete="off" placeholder="ПІБ або телефон" onChange={(event) => change('search', event.target.value, true)} />
      </form>
      <div className="min-w-0"><label htmlFor="reader-category-filter" className="mb-2 block text-sm font-medium">Категорія</label>
        <select id="reader-category-filter" className="form-input" value={categoryId} disabled={categories.resource.status !== 'success'} onChange={(event) => change('categoryId', event.target.value)}>
          <option value="">Усі категорії</option>
          {categoryId && categories.resource.status === 'success' && !categories.resource.data.some((category) => category.id === categoryId) && <option value={categoryId}>Категорія недоступна</option>}
          {categories.resource.status === 'success' && categories.resource.data.map((category) => <option key={category.id} value={category.id}>{category.name} — {category.discountPercent.replace('.', ',')}%</option>)}
        </select>
        {categories.resource.status === 'loading' && <p role="status" className="mt-2 text-xs text-muted">Завантажуємо категорії…</p>}
      </div>
      <div><label htmlFor="reader-page-size" className="mb-2 block text-sm font-medium">На сторінці</label>
        <select id="reader-page-size" className="form-input" value={pageSize} onChange={(event) => change('pageSize', event.target.value)}>
          {[...new Set([10, 20, 50, pageSize])].sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </div>
    </div>
    {categories.resource.status === 'error' && <div className="mb-5"><ErrorState error={categories.resource.error} retry={categories.retry} title="Не вдалося завантажити категорії" /></div>}
    <section aria-label="Список читачів" aria-busy={resource.status === 'loading'}>
      {resource.status === 'loading' && <LoadingState message="Завантажуємо читачів…" />}
      {resource.status === 'error' && <ErrorState error={resource.error} retry={retry} title="Не вдалося завантажити читачів" />}
      {resource.status === 'success' && <>
        <p role="status" className="mb-5 text-sm text-muted">Знайдено читачів: {resource.data.pagination.total}</p>
        {resource.data.data.length === 0 ? <div className="rounded-3xl border border-line bg-white px-6 py-14 text-center">
          <h2 className="text-xl font-semibold">{page > 1 ? 'На цій сторінці немає читачів' : search || categoryId ? 'Читачів не знайдено' : 'Читачів ще не зареєстровано'}</h2>
          <p className="mt-3 text-sm text-muted">{search || categoryId ? 'Змініть умови пошуку або скиньте фільтри.' : 'Додайте нового читача, щоб створити його профіль.'}</p>
          {(search || categoryId || page > 1) && <button type="button" className="button-secondary mt-5" onClick={() => setParams({})}>Скинути фільтри</button>}
        </div> : <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {resource.data.data.map((reader) => <li key={reader.id} className="min-w-0">
            <Link to={{ pathname: `/readers/${reader.id}`, search: params.toString() }} className="group flex h-full flex-col rounded-2xl border border-line bg-white p-6 hover:border-pine/35">
              <h2 className="break-words text-lg font-semibold leading-7">{reader.fullName}</h2>
              <p className="mt-3 break-words text-sm text-muted">{reader.phone}</p>
              <p className="mt-5 break-words text-sm text-pine">{reader.category.name} · знижка {reader.category.discountPercent.replace('.', ',')}%</p>
              <span className="mt-6 text-sm font-medium text-pine group-hover:underline">Переглянути профіль →</span>
            </Link>
          </li>)}
        </ul>}
        <Pagination pagination={resource.data.pagination} params={params} label="Сторінки списку читачів" />
      </>}
    </section>
  </>;
}
