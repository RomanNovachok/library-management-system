import { useCallback } from 'react';
import type { FinancialReport } from '../../api/report-contract';
import { getFinancialReport } from '../../api/reports';
import { useApiResource } from '../../hooks/useApiResource';
import { formatReportMoney as money } from '../../utils/money';
import { cashLabels } from '../../utils/report-display';
import { periodLabel } from '../../utils/report-period';
import { rentalDate } from '../../utils/rental-display';
import { ErrorState, LoadingState } from '../ApiFeedback';
import { Pagination } from '../Pagination';
import { Metrics, ReportLink, ReportPanel, ReportTable } from './ReportView';

const series = [
  ['totalCharges', 'Нарахування', 'bg-pine'],
  ['inflow', 'Надходження', 'bg-[#6c9280]'],
  ['outflow', 'Виплати', 'bg-[#be864f]'],
] as const;
const cents = (value: string) => BigInt(value.replace('.', ''));

function FinancialTrend({ trend }: { trend: FinancialReport['trend'] }) {
  if (!trend.interval || !trend.data.length) return null;
  let max = 1n;
  for (const point of trend.data) {
    for (const [key] of series) {
      const value = cents(point[key]);
      if (value > max) max = value;
    }
  }
  const calendar = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'UTC', ...(trend.interval === 'day' ? { day: 'numeric', month: 'short' } : { month: 'short', year: 'numeric' }),
  });
  return <ReportPanel title="Динаміка за період" description={trend.interval === 'day' ? 'Дні з нарахуваннями або касовими операціями.' : 'Місяці з нарахуваннями або касовими операціями.'}>
    <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
      {series.map(([key, label, color]) => <span key={key} className="inline-flex items-center gap-2"><span className={`size-2.5 rounded-sm ${color}`} />{label}</span>)}
    </div>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Графік фінансових операцій">
      <ul className="flex min-w-full w-max items-end gap-3" aria-label="Підсумки за календарними інтервалами">
        {trend.data.map((point) => {
          const date = calendar.format(new Date(`${point.bucket}T00:00:00Z`));
          return <li key={point.bucket} className="min-w-16 text-center text-xs text-muted">
            <div className="flex h-28 items-end justify-center gap-1 border-b border-line">
              {series.map(([key, label, color]) => {
                const amount = cents(point[key]);
                const basis = amount > 0n ? (amount * 10_000n + max - 1n) / max : 0n;
                const caption = `${date}, ${label.toLowerCase()} ${money(point[key])}`;
                return <span key={key} className={`w-3 rounded-t-sm ${color}`} style={{ height: `${basis / 100n}.${String(basis % 100n).padStart(2, '0')}%` }}
                  title={caption}><span className="sr-only">{caption}</span></span>;
              })}
            </div>
            <span className="mt-2 block">{date}</span>
          </li>;
        })}
      </ul>
    </div>
  </ReportPanel>;
}

export function FinancialResults({ query, params }: { query: string; params: URLSearchParams }) {
  const load = useCallback((signal: AbortSignal) => getFinancialReport(query, signal), [query]);
  const { resource, retry } = useApiResource(load);
  if (resource.status === 'loading') return <LoadingState message="Завантажуємо фінансовий звіт…" />;
  if (resource.status === 'error') return <ErrorState error={resource.error} retry={retry} />;
  const { summary, charges, cash, period, trend, generatedAt } = resource.data;
  const dates = periodLabel(period);
  const chargesTitle = 'Нарахування за завершеними прокатами';
  const cashTitle = 'Касові операції';
  return <div className="space-y-5">
    <ReportPanel title="Нарахування доходу" description={`За датою закриття прокату · ${dates}`}>
      <Metrics values={[
        ['Дохід від прокату', money(summary.charges.rentalFee)], ['Штрафи й компенсації', money(summary.charges.damageFine)],
        ['Загальні нарахування', money(summary.charges.totalCharges)],
      ]} />
    </ReportPanel>
    <ReportPanel title="Касові рухи" description={`За датою операції · ${dates}`}>
      <Metrics values={[
        ['Отримані застави', money(summary.cash.depositIn)], ['Повернені застави', money(summary.cash.refundOut)],
        ['Отримані доплати', money(summary.cash.topupIn)], ['Загальні надходження', money(summary.cash.inflow)],
        ['Загальні виплати', money(summary.cash.outflow)], ['Чистий рух коштів', money(summary.cash.netCash)],
      ]} />
    </ReportPanel>
    <ReportPanel title="Поточні неврегульовані застави" description={`Зобов’язання за всіма активними прокатами станом на ${rentalDate(generatedAt)}.`}>
      <Metrics values={[[ 'Активні прокати', summary.outstanding.activeRentals], ['Неврегульовані застави', money(summary.outstanding.deposits)]]} />
    </ReportPanel>
    <FinancialTrend trend={trend} />
    <ReportPanel title={chargesTitle}>
      <ReportTable title={chargesTitle} columns={['Закрито', 'Книга', 'Читач', 'Плата за прокат', 'Штраф', 'Застава', 'Повернення', 'Доплата', 'Нараховано', 'Прокат']}
        empty={charges.pagination.total ? 'На цій сторінці немає записів.' : 'За цей період немає завершених прокатів.'}
        rows={charges.data.map((row) => ({ id: row.id, cells: [
          rentalDate(row.closedAt), <ReportLink to={`/books/${row.book.id}`}>{row.book.title}</ReportLink>,
          <ReportLink to={`/readers/${row.reader.id}`}>{row.reader.fullName}</ReportLink>,
          ...[row.rentalFee, row.damageFine, row.deposit, row.refund, row.topup, row.totalCharges].map(money),
          <ReportLink to={`/rentals/${row.id}`}>Деталі</ReportLink>,
        ] }))} />
      <Pagination pagination={charges.pagination} params={params} pageKey="chargesPage" label="Сторінки нарахувань" />
    </ReportPanel>
    <ReportPanel title={cashTitle}>
      <ReportTable title={cashTitle} columns={['Дата й час', 'Операція', 'Сума', 'Книга', 'Інв. номер', 'Працівник', 'Прокат']}
        empty={cash.pagination.total ? 'На цій сторінці немає записів.' : 'За цей період немає касових операцій.'}
        rows={cash.data.map((row) => ({ id: row.id, cells: [
          rentalDate(row.createdAt), cashLabels[row.type], money(row.amount), <ReportLink to={`/books/${row.book.id}`}>{row.book.title}</ReportLink>,
          row.inventoryCode, row.staffEmail, <ReportLink to={`/rentals/${row.rentalId}`}>Деталі</ReportLink>,
        ] }))} />
      <Pagination pagination={cash.pagination} params={params} pageKey="cashPage" label="Сторінки касових операцій" />
    </ReportPanel>
  </div>;
}
