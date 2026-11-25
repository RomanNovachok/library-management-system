import { useCallback, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { getRental } from '../api/rentals';
import type { CashMovement } from '../api/rental-contract';
import { ErrorState, LoadingState } from '../components/ApiFeedback';
import { CopyStatusBadge } from '../components/CopyStatusBadge';
import { RentalFields } from '../components/rentals/RentalFields';
import { RentalStatusBadge } from '../components/rentals/RentalStatusBadge';
import { ReturnRentalForm } from '../components/rentals/ReturnRentalForm';
import { useApiResource } from '../hooks/useApiResource';
import { rentalDate, rentalMoney, rentalPercent } from '../utils/rental-display';
import { conditionLabel } from '../utils/copy-condition';
import { detailBack, detailLink } from '../utils/detail-navigation';

const movementLabels: Record<CashMovement['type'], string> = {
  DEPOSIT_IN: 'Отримання застави', REFUND_OUT: 'Повернення залишку застави', TOPUP_IN: 'Отримання доплати',
};

export function RentalDetailsPage() {
  const { id = '' } = useParams();
  return <RentalDetailsContent key={id} id={id} />;
}

function RentalDetailsContent({ id }: { id: string }) {
  const location = useLocation();
  const back = detailBack(location, { pathname: '/rentals', search: location.search }, 'Повернутися до прокатів');
  const [returning, setReturning] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback((signal: AbortSignal) => getRental(id, signal), [id]);
  const { resource, retry } = useApiResource(load);
  const rental = resource.status === 'success' ? resource.data : null;
  return <>
    <Link to={back.to} state={back.state} className="mb-6 inline-flex min-h-11 items-center text-sm font-medium text-pine hover:underline">← {back.label}</Link>
    {notice && <p role="status" className="mb-5 rounded-xl border border-line bg-sage p-4 text-sm text-pine">{notice}</p>}
    {resource.status === 'loading' && <LoadingState message="Завантажуємо прокат…" />}
    {resource.status === 'error' && <ErrorState error={resource.error} retry={retry} title="Не вдалося завантажити прокат" />}
    {rental && <>
      {returning && <ReturnRentalForm rental={rental} onClose={() => setReturning(false)} onRefresh={() => { setReturning(false); retry(); }}
        onSaved={(closed) => { setReturning(false); setNotice(closed.status === 'LOST' ? 'Втрату книги оформлено, прокат закрито.' : 'Повернення оформлено, прокат закрито.'); retry(); }} />}
      <section className="rounded-3xl border border-line bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="page-title break-words">{rental.copy.book.title}</h1>
            <p className="mt-2 break-words text-sm text-muted">{rental.copy.book.author} · {rental.copy.inventoryCode}</p>
          </div>
          {rental.status === 'ACTIVE' && <button type="button" className="button-primary" onClick={() => setReturning(true)}>Оформити повернення</button>}
        </div>
        <div className="my-6"><RentalStatusBadge status={rental.status} overdue={rental.overdue} /></div>
        <RentalFields fields={[
          ['Читач', <Link {...detailLink(location, `/readers/${rental.reader.id}`)} className="text-pine underline">{rental.reader.fullName}</Link>],
          ['Книга', <Link {...detailLink(location, `/books/${rental.copy.book.id}`)} className="text-pine underline">Картка книги та примірники</Link>],
          ['Видано', rentalDate(rental.issuedAt)], ['Видав працівник', rental.issuedBy.email],
          ['Очікуване повернення', rentalDate(rental.dueAt)], ['Поточна доступність', <CopyStatusBadge status={rental.copy.status} />],
          ...(rental.closedAt ? [[rental.status === 'LOST' ? 'Закрито через втрату' : 'Повернено', rentalDate(rental.closedAt)],
            ['Закрив працівник', rental.closedBy?.email ?? '—']] as [string, string][] : []),
        ]} />
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="min-w-0 rounded-3xl border border-line bg-white p-6">
          <h2 className="mb-5 text-lg font-semibold">Умови на момент видачі</h2>
          <RentalFields fields={[
            ['Ціна за добу', rentalMoney(rental.pricePerDaySnapshot)], ['Застава', rentalMoney(rental.depositSnapshot)],
            ['Знижка', rentalPercent(rental.discountPercentSnapshot)], ['Категорія читача', rental.readerCategorySnapshot],
            ['Фізичний стан при видачі', conditionLabel(rental.conditionAtIssue)],
            ['Наявні при видачі пошкодження', <span className="whitespace-pre-wrap">{rental.conditionNotesAtIssue ?? (rental.conditionAtIssue ? 'Немає' : 'Не зафіксовано')}</span>],
          ]} />
          {rental.status === 'ACTIVE' && rental.conditionAtIssue === null && <p className="mt-4 text-sm text-amber-950">
            Початкового огляду немає. Під час повернення зафіксуйте стан примірника.
          </p>}
        </section>
        {rental.status !== 'ACTIVE' && <section className="min-w-0 rounded-3xl border border-line bg-white p-6">
          <h2 className="mb-5 text-lg font-semibold">Остаточний розрахунок</h2>
          <RentalFields fields={[
            ['Оплачувані дні', rental.billableDays], [rental.conditionAtReturn ? 'Застосоване правило штрафу' : 'Історичне правило штрафу', rental.damageRule?.label ?? '—'],
            ['Фізичний стан після повернення', conditionLabel(rental.conditionAtReturn)],
            ['Загальний опис пошкоджень', <span className="whitespace-pre-wrap">{rental.conditionNotesAtReturn ?? (rental.conditionAtReturn ? 'Немає запису' : 'Не зафіксовано')}</span>],
            ['Нові пошкодження', <span className="whitespace-pre-wrap">{rental.newDamageNotes ?? (rental.conditionAtReturn ? 'Немає запису' : 'Не зафіксовано')}</span>],
            ['Вартість прокату', rentalMoney(rental.rentalFee)], ['Штраф', rentalMoney(rental.damageFine)],
            ['Ставка штрафу', rental.damagePercentSnapshot ? rentalPercent(rental.damagePercentSnapshot) : '—'],
            ['Повернення застави', rentalMoney(rental.refundAmount)], ['Доплата', rentalMoney(rental.additionalPayment)],
          ]} />
        </section>}
      </div>
      <section className="mt-6 rounded-3xl border border-line bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold">Касові рухи</h2>
        {rental.cashMovements.length ? <ul className="divide-y divide-line">
          {rental.cashMovements.map((movement) => <li key={movement.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
            <div className="min-w-0"><p className="font-medium">{movementLabels[movement.type]}</p>
              <p className="mt-1 break-words text-sm text-muted">{rentalDate(movement.createdAt)} · {movement.recordedBy.email}</p></div>
            <p className="font-medium">{rentalMoney(movement.amount)}</p>
          </li>)}
        </ul> : <p className="text-sm text-muted">Касових рухів немає.</p>}
      </section>
    </>}
  </>;
}
