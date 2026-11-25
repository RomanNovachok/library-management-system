import { useCallback } from 'react';
import { Link } from 'react-router';
import { getDashboard } from '../api/reports';
import type { ReportRental } from '../api/report-contract';
import { useAuth } from '../auth/useAuth';
import { ErrorState, LoadingState } from '../components/ApiFeedback';
import { Icon } from '../components/Icon';
import { Metrics, ReportLink, ReportPanel, ReportTable } from '../components/reports/ReportView';
import { useApiResource } from '../hooks/useApiResource';
import { formatReportMoney as money } from '../utils/money';
import { overdueDuration } from '../utils/report-display';
import { localTimeZone, periodLabel } from '../utils/report-period';
import { rentalDate } from '../utils/rental-display';
import { sections } from './sections';

function Activity({ rows, closing }: { rows: ReportRental[]; closing?: boolean }) {
  const title = closing ? 'Останні закриття' : 'Останні видачі';
  return <ReportPanel title={title}>
    <ReportTable title={title} columns={['Книга', 'Читач', 'Операція', 'Дата', 'Прокат']}
      empty={closing ? 'Закритих прокатів ще немає.' : 'Видач ще немає.'}
      rows={rows.map((row) => ({ id: row.id, cells: [
        <ReportLink to={`/books/${row.book.id}`}>{row.book.title}</ReportLink>,
        <ReportLink to={`/readers/${row.reader.id}`}>{row.reader.fullName}</ReportLink>,
        closing ? row.status === 'LOST' ? 'Втрачено' : 'Повернено' : 'Видано',
        closing && row.closedAt ? rentalDate(row.closedAt) : rentalDate(row.issuedAt),
        <ReportLink to={`/rentals/${row.id}`}>Деталі</ReportLink>,
      ] }))} />
  </ReportPanel>;
}

export function DashboardPage() {
  const { state } = useAuth();
  const admin = state.status === 'authenticated' && state.user.role === 'ADMIN';
  const load = useCallback((signal: AbortSignal) => getDashboard(localTimeZone(), signal), []);
  const { resource, retry } = useApiResource(load);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="page-title">Робочий простір</h1>
      {resource.status === 'success' && <button className="button-secondary" type="button" onClick={retry}>Оновити показники</button>}
    </div>
    {resource.status === 'loading' && <LoadingState message="Завантажуємо показники бібліотеки…" />}
    {resource.status === 'error' && <ErrorState error={resource.error} retry={retry} title="Не вдалося завантажити показники" />}
    {resource.status === 'success' && <>
      <ReportPanel title="Стан бібліотеки" description={`Оновлено ${rentalDate(resource.data.generatedAt)}`}>
        <Metrics values={[
          ['Видання в робочому каталозі', resource.data.summary.editions],
          ['Доступні примірники робочого каталогу', resource.data.summary.availableCopies],
          ['Зареєстровані читачі', resource.data.summary.readers], ['Активні прокати', resource.data.summary.activeRentals],
          ['Прострочені прокати', resource.data.summary.overdueRentals], ['Примірники на обслуговуванні', resource.data.summary.maintenanceCopies],
        ]} />
      </ReportPanel>
      <ReportPanel title="Фінанси" description={`Нарахування за поточний місяць · ${periodLabel(resource.data.period)}`}>
        <Metrics values={[
          ['Дохід від прокату за місяць', money(resource.data.financial.rentalFee)],
          ['Штрафи й компенсації за місяць', money(resource.data.financial.damageFine)],
          ['Поточні неврегульовані застави', money(resource.data.financial.outstandingDeposits)],
        ]} />
      </ReportPanel>
      {resource.data.overdue.length > 0 && <ReportPanel title="Потребують повернення">
        <ul className="mb-4 divide-y divide-line">
          {resource.data.overdue.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
            <div><ReportLink to={`/rentals/${row.id}`}>{row.book.title} · {row.inventoryCode}</ReportLink>
              <span className="ml-3 text-muted">{row.reader.fullName}</span></div>
            <span className="text-amber-800">{row.overdueMs !== null && overdueDuration(row.overdueMs)}</span>
          </li>)}
        </ul>
        <Link to="/rentals?status=ACTIVE&overdue=true" className="button-secondary">Усі прострочені прокати</Link>
      </ReportPanel>}
      <div className="grid gap-5 2xl:grid-cols-2">
        <Activity rows={resource.data.latestIssues} />
        <Activity rows={resource.data.latestClosures} closing />
      </div>
    </>}
    <section aria-labelledby="sections-title">
      <h2 id="sections-title" className="mb-4 text-lg font-semibold tracking-tight text-ink">Швидкі переходи</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sections.filter((section) => section.path !== '/dashboard' && (admin || section.path !== '/administration')).map((section) => (
          <Link key={section.path} to={section.path} className="group flex items-center gap-3 rounded-2xl border border-line bg-white p-4 hover:border-pine/35">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sage text-pine"><Icon name={section.icon} className="size-5" /></span>
            <span className="grow text-sm font-semibold text-ink">{section.title}</span>
            <Icon name="arrow" className="size-4 shrink-0 text-muted" />
          </Link>
        ))}
      </div>
    </section>
  </div>;
}
