import type { RentalStatus } from '../api/rental-contract';
import { formatHryvnia } from './money';

export const rentalStatusLabels: Record<RentalStatus, string> = {
  ACTIVE: 'Активний', RETURNED: 'Повернено', LOST: 'Втрачено',
};
export const rentalDate = (value: string) => new Date(value).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' });
export const rentalMoney = (value: string | null) => value === null ? '—' : formatHryvnia(value);
export const rentalPercent = (value: string) => `${value.replace('.', ',')}%`;
