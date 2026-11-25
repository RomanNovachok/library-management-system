import type { Period } from '../api/report-contract';

export type Preset = 'today' | 'last7' | 'month' | 'custom';
export const reportPresets = [
  ['month', 'Поточний місяць'], ['today', 'Сьогодні'], ['last7', 'Останні 7 днів'], ['custom', 'Довільний період'],
] as const;
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function calendarDate(year: number, month: number, day: number) {
  const value = new Date(0);
  value.setHours(0, 0, 0, 0);
  value.setFullYear(year, month, day);
  return value;
}

function dateInput(date: Date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseCalendarDate(input: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  const day = Number(input.slice(8, 10));
  const date = calendarDate(year, month - 1, day);
  return year >= 1 && dateInput(date) === input ? date : null;
}

export function calendarRange(preset: Exclude<Preset, 'custom'>, now: Date) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const start = calendarDate(year, month, preset === 'month' ? 1 : day - (preset === 'last7' ? 6 : 0));
  const end = preset === 'month' ? calendarDate(year, month + 1, 0) : now;
  return { fromDate: dateInput(start), toDate: dateInput(end) };
}

export function utcRange(fromDate: string, toDate: string) {
  const start = parseCalendarDate(fromDate);
  const end = parseCalendarDate(toDate);
  if (!start || !end || start > end) return null;
  const exclusiveEnd = calendarDate(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  if (start.getUTCFullYear() < 1 || exclusiveEnd.getUTCFullYear() > 9999) return null;
  return { from: start.toISOString(), to: exclusiveEnd.toISOString() };
}

export function selectedPeriod(params: URLSearchParams, now: Date) {
  const preset = reportPresets.find(([value]) => value === params.get('period'))?.[0] ?? 'month';
  const dates = preset === 'custom'
    ? { fromDate: params.get('fromDate') ?? '', toDate: params.get('toDate') ?? '' }
    : calendarRange(preset, now);
  return { preset, dates, range: utcRange(dates.fromDate, dates.toDate) };
}

export function periodLabel(period: Period) {
  const calendar = new Intl.DateTimeFormat('uk-UA', { timeZone: period.timeZone, dateStyle: 'medium' });
  const start = calendar.format(new Date(period.from));
  const end = calendar.format(Date.parse(period.to) - 1);
  return start === end ? start : `${start} — ${end}`;
}
