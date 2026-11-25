import { useCallback } from 'react';
import { getRentalsReport } from '../../api/reports';
import { useApiResource } from '../../hooks/useApiResource';
import { overdueDuration } from '../../utils/report-display';
import { periodLabel } from '../../utils/report-period';
import { rentalDate } from '../../utils/rental-display';
import { ErrorState, LoadingState } from '../ApiFeedback';
import { Pagination } from '../Pagination';
import { RentalStatusBadge } from '../rentals/RentalStatusBadge';
import { Metrics, ReportLink, ReportPanel, ReportTable } from './ReportView';

export function RentalsResults({ query, params }: { query: string; params: URLSearchParams }) {
  const load = useCallback((signal: AbortSignal) => getRentalsReport(query, signal), [query]);
  const { resource, retry } = useApiResource(load, 250);
  if (resource.status === 'loading') return <LoadingState message="Завантажуємо звіт про прокати…" />;
  if (resource.status === 'error') return <ErrorState error={resource.error} retry={retry} />;
  const { summary: { current, events }, data, pagination, generatedAt, period, filters } = resource.data;
  const title = filters.dateBy === 'closedAt' ? 'Прокати за датою закриття' : 'Прокати за датою видачі';
  return <div className="space-y-5">
    <ReportPanel title="Поточний стан прокатів" description={`Стан на ${rentalDate(generatedAt)} за фільтрами пошуку та статусу, за весь час.`}>
      <Metrics values={[
        ['Усі прокати', current.total], ['Активні', current.byStatus.ACTIVE], ['Повернені', current.byStatus.RETURNED],
        ['Втрачені', current.byStatus.LOST], ['Прострочені активні', current.overdue],
      ]} />
    </ReportPanel>
    <ReportPanel title="Події за період" description={periodLabel(period)}>
      <Metrics values={[[ 'Видачі за датою видачі', events.issued], ['Закриття за датою закриття', events.closed]]} />
    </ReportPanel>
    <ReportPanel title={title}>
      <ReportTable title={title} columns={['Книга', 'Інв. номер', 'Читач', 'Видано', 'Повернути до', 'Закрито', 'Статус', 'Прострочення', 'Прокат']}
        empty={pagination.total ? 'На цій сторінці немає прокатів.' : 'Прокатів за вибраними фільтрами не знайдено.'}
        rows={data.map((row) => ({ id: row.id, cells: [
          <ReportLink to={`/books/${row.book.id}`}>{row.book.title}</ReportLink>, row.inventoryCode,
          <ReportLink to={`/readers/${row.reader.id}`}>{row.reader.fullName}</ReportLink>,
          rentalDate(row.issuedAt), rentalDate(row.dueAt), row.closedAt ? rentalDate(row.closedAt) : '—',
          <RentalStatusBadge status={row.status} overdue={row.overdueMs !== null} />,
          row.overdueMs === null ? '—' : overdueDuration(row.overdueMs), <ReportLink to={`/rentals/${row.id}`}>Деталі</ReportLink>,
        ] }))} />
      <Pagination pagination={pagination} params={params} label="Сторінки звіту про прокати" />
    </ReportPanel>
  </div>;
}
