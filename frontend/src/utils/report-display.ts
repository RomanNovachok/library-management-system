import type { CashType } from '../api/report-contract';
import type { CopyStatus } from '../api/book-contract';

export const availabilityLabels: Record<CopyStatus, string> = {
  AVAILABLE: 'Статус «Доступний»', RENTED: 'Видані', MAINTENANCE: 'На обслуговуванні', LOST: 'Втрачені',
};
export const cashLabels: Record<CashType, string> = {
  DEPOSIT_IN: 'Отримання застави', REFUND_OUT: 'Повернення застави', TOPUP_IN: 'Отримання доплати',
};

export function overdueDuration(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) return 'Менше 1 хв';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const parts = [days ? `${days} дн.` : '', hours ? `${hours} год` : '', minutes % 60 ? `${minutes % 60} хв` : ''];
  return parts.filter(Boolean).join(' ');
}
