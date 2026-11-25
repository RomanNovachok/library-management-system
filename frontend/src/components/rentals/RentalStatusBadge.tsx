import type { RentalStatus } from '../../api/rental-contract';
import { rentalStatusLabels } from '../../utils/rental-display';
const colors: Record<RentalStatus, string> = {
  ACTIVE: 'bg-sky-50 text-sky-800', RETURNED: 'bg-emerald-50 text-emerald-800', LOST: 'bg-rose-50 text-rose-800',
};

export function RentalStatusBadge({ status, overdue = false }: { status: RentalStatus; overdue?: boolean }) {
  return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${overdue ? 'bg-amber-50 text-amber-900' : colors[status]}`}>
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
    {overdue ? 'Прострочено' : rentalStatusLabels[status]}
  </span>;
}
