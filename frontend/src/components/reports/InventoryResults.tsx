import { useCallback, type ReactNode } from 'react';
import { availability, conditions } from '../../api/report-contract';
import { getInventoryReport } from '../../api/reports';
import { useApiResource } from '../../hooks/useApiResource';
import { conditionLabel } from '../../utils/copy-condition';
import { availabilityLabels } from '../../utils/report-display';
import { rentalDate } from '../../utils/rental-display';
import { ErrorState, LoadingState } from '../ApiFeedback';
import { Pagination } from '../Pagination';
import { Metrics, ReportLink, ReportPanel, ReportTable } from './ReportView';

export function InventoryResults({ query, params, renderFilters }: {
  query: string; params: URLSearchParams; renderFilters: (genres: string[]) => ReactNode;
}) {
  const load = useCallback((signal: AbortSignal) => getInventoryReport(query, signal), [query]);
  const { resource, retry } = useApiResource(load, 250);
  const filters = renderFilters(resource.status === 'success' ? resource.data.genres : []);
  if (resource.status === 'loading') return <>{filters}<LoadingState message="Завантажуємо стан книжкового фонду…" /></>;
  if (resource.status === 'error') return <>{filters}<ErrorState error={resource.error} retry={retry} /></>;
  const { summary, data, pagination, generatedAt } = resource.data;
  const title = 'Видання та примірники';
  return <>{filters}<div className="space-y-5">
    <ReportPanel title="Книжковий фонд" description={`Стан на ${rentalDate(generatedAt)}. Підсумки враховують усі відфільтровані видання. Для видачі доступні примірники зі статусом «Доступний» у неархівованих виданнях.`}>
      <Metrics values={[
        ['Видання', summary.editions], ['Архівовані видання', summary.archivedEditions], ['Усі примірники', summary.copies],
        ['Доступні для видачі', summary.availableForIssue],
        ...availability.map((status) => [availabilityLabels[status], summary.availability[status]] as const),
      ]} />
    </ReportPanel>
    <ReportPanel title="Фізичний стан примірників">
      <Metrics values={conditions.map((condition) => [conditionLabel(condition), summary.conditions[condition]])} />
    </ReportPanel>
    <ReportPanel title={title}>
      <ReportTable title={title} columns={['Книга', 'Автор', 'Жанр', 'Примірники', 'Доступні для видачі', ...availability.map((status) => availabilityLabels[status]), 'Каталог']}
        empty={pagination.total ? 'На цій сторінці немає видань.' : 'Видань за вибраними фільтрами не знайдено.'}
        rows={data.map((row) => ({ id: row.id, cells: [
          <ReportLink to={`/books/${row.id}`}>{row.title}</ReportLink>, row.author, row.genre, row.copies, row.availableForIssue,
          ...availability.map((status) => row.availability[status]), row.archived ? 'Архів' : 'Активне',
        ] }))} />
      <Pagination pagination={pagination} params={params} label="Сторінки книжкового фонду" />
    </ReportPanel>
  </div></>;
}
