import type { CopyStatus } from '../api/book-contract';

const statuses: Record<CopyStatus, { label: string; className: string }> = {
  AVAILABLE: { label: 'Доступний', className: 'bg-emerald-50 text-emerald-800' },
  RENTED: { label: 'Виданий', className: 'bg-sky-50 text-sky-800' },
  MAINTENANCE: { label: 'На обслуговуванні', className: 'bg-amber-50 text-amber-900' },
  LOST: { label: 'Втрачений', className: 'bg-rose-50 text-rose-800' },
};

export function CopyStatusBadge({ status }: { status: CopyStatus }) {
  const { label, className } = statuses[status];
  return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${className}`}>
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />{label}
  </span>;
}
