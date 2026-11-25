import { Link, useSearchParams } from 'react-router';
import { isRentalStatus, rentalStatuses } from '../api/rental-contract';
import { FinancialResults } from '../components/reports/FinancialResults';
import { InventoryResults } from '../components/reports/InventoryResults';
import { PeriodFilter } from '../components/reports/PeriodFilter';
import { RentalsResults } from '../components/reports/RentalsResults';
import { positivePage } from '../utils/reader-forms';
import { localTimeZone, selectedPeriod } from '../utils/report-period';
import { rentalStatusLabels } from '../utils/rental-display';

const tabs = [
  ['inventory', 'Книжковий фонд', 'Видання, доступність і фізичний стан примірників.'],
  ['rentals', 'Прокати', 'Поточні статуси, видачі й закриття прокатів.'],
  ['financial', 'Фінанси', 'Історичні нарахування, касові операції та поточні зобов’язання за заставами.'],
] as const;
const periodKeys = ['period', 'fromDate', 'toDate'] as const;

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, , description] = tabs.find(([value]) => value === params.get('tab')) ?? tabs[0];
  const { preset, dates, range } = selectedPeriod(params, new Date());
  const pageSize = positivePage(params.get('pageSize'), 20, 100);
  const archive = params.get('archived');
  const archived = archive === 'active' || archive === 'archived' ? archive : 'all';
  const rawStatus = params.get('status');
  const status = isRentalStatus(rawStatus) ? rawStatus : '';
  const overdue = params.get('overdue') === 'true';
  const dateBy = params.get('dateBy') === 'closedAt' ? 'closedAt' : 'issuedAt';
  const search = params.get('search') ?? '';
  const genre = params.get('genre') ?? '';

  function change(values: Record<string, string>, replace = false) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value); else next.delete(key);
      }
      for (const key of ['page', 'chargesPage', 'cashPage']) next.delete(key);
      return next;
    }, { replace });
  }

  function tabSearch(target: typeof tab) {
    if (target === tab) return params.toString();
    const next = new URLSearchParams();
    if (target !== 'inventory') next.set('tab', target);
    for (const key of periodKeys) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    return next.toString();
  }

  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (tab === 'financial') {
    query.set('chargesPage', String(positivePage(params.get('chargesPage'))));
    query.set('cashPage', String(positivePage(params.get('cashPage'))));
  } else {
    query.set('page', String(positivePage(params.get('page'))));
    if (search.trim()) query.set('search', search.trim().slice(0, 1000));
  }
  if (tab === 'inventory') {
    query.set('archived', archived);
    if (genre.trim()) query.set('genre', genre.trim().slice(0, 1000));
  } else {
    query.set('timeZone', localTimeZone());
    if (range) {
      query.set('from', range.from);
      query.set('to', range.to);
    }
    if (tab === 'rentals') {
      query.set('dateBy', dateBy);
      if (status) query.set('status', status);
      if (overdue) query.set('overdue', 'true');
    }
  }

  function renderFilters(genres: string[] = []) {
    const selectedGenre = genres.find((option) => option.toLowerCase() === genre.trim().toLowerCase()) ?? genre.trim();
    return <div className="my-6 flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6">
      {tab !== 'inventory' && <PeriodFilter preset={preset} dates={dates} change={change} />}
      {tab !== 'financial' && <label className="block grow text-sm font-medium">Пошук
        <input type="search" className="form-input mt-2" maxLength={1000} value={search}
          placeholder={tab === 'inventory' ? 'Назва, автор або жанр' : 'Читач, книга або інв. номер'}
          onChange={(event) => change({ search: event.target.value }, true)} />
      </label>}
      {tab === 'inventory' && <>
        <label className="block text-sm font-medium">Жанр
          <select className="form-input mt-2" value={selectedGenre} onChange={(event) => change({ genre: event.target.value })}>
            <option value="">Усі жанри</option>
            {selectedGenre && !genres.includes(selectedGenre) && <option value={selectedGenre}>{selectedGenre}</option>}
            {genres.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Видання
          <select className="form-input mt-2" value={archived} onChange={(event) => change({ archived: event.target.value })}>
            <option value="all">Усі видання</option><option value="active">Лише активні</option><option value="archived">Лише архівовані</option>
          </select>
        </label>
      </>}
      {tab === 'rentals' && <>
        <label className="block text-sm font-medium">Дата для відбору рядків
          <select className="form-input mt-2" value={dateBy} onChange={(event) => change({ dateBy: event.target.value })}>
            <option value="issuedAt">Дата видачі</option><option value="closedAt">Дата закриття</option>
          </select>
        </label>
        <label className="block text-sm font-medium">Поточний статус
          <select className="form-input mt-2" value={status} onChange={(event) => {
            const value = event.target.value;
            change(value && value !== 'ACTIVE' ? { status: value, overdue: '' } : { status: value });
          }}>
            <option value="">Усі статуси</option>
            {rentalStatuses.map((value) => <option key={value} value={value}>{rentalStatusLabels[value]}</option>)}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="size-4 accent-pine" checked={overdue}
            onChange={(event) => change(event.target.checked ? { overdue: 'true', status: status === 'ACTIVE' ? status : '' } : { overdue: '' })} />
          Лише прострочені
        </label>
      </>}
      <label className="block text-sm font-medium">На сторінці
        <select className="form-input mt-2" value={pageSize} onChange={(event) => change({ pageSize: event.target.value })}>
          {[...new Set([10, 20, 50, pageSize])].sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
    </div>;
  }

  return <>
    <h1 className="page-title">Звіти</h1>
    <nav aria-label="Види звітів" className="mt-6 flex flex-wrap gap-2 border-b border-line pb-3">
      {tabs.map(([value, label]) => <Link key={value} to={{ search: tabSearch(value) }} aria-current={tab === value ? 'page' : undefined}
        className={tab === value ? 'button-primary' : 'button-secondary'}>{label}</Link>)}
    </nav>
    <p className="mt-4 text-sm text-muted">{description}</p>
    {tab === 'inventory' ? <InventoryResults query={query.toString()} params={params} renderFilters={renderFilters} /> : renderFilters()}
    {tab === 'rentals' && range && <RentalsResults query={query.toString()} params={params} />}
    {tab === 'financial' && range && <FinancialResults query={query.toString()} params={params} />}
    {tab !== 'inventory' && !range && <p role="alert" className="rounded-xl border border-amber-200 bg-white p-4 text-sm">Вкажіть коректні межі звітного періоду.</p>}
  </>;
}
