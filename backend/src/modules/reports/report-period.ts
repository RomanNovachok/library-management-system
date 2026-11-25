const dayMs = 86_400_000;
export type ReportPeriod = { from: Date; to: Date; timeZone: string };

export function reportPeriod(query: { from?: Date | undefined; to?: Date | undefined; timeZone: string }, now: Date): ReportPeriod {
  const { from, to, timeZone } = query;
  if (from && to) return { from, to, timeZone };
  const calendar = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
  const parts = calendar.formatToParts(now);
  const year = Number(parts.find(({ type }) => type === 'year')?.value);
  const month = Number(parts.find(({ type }) => type === 'month')?.value) - 1;

  function startOfMonth(offset: number) {
    const target = new Date(0);
    target.setUTCFullYear(year, month + offset, 1);
    const utc = target.getTime();
    const firstYear = target.getUTCFullYear();
    const firstMonth = target.getUTCMonth() + 1;
    // Find the first instant of the local month, including zones with a midnight DST change.
    let low = utc - dayMs;
    let high = utc + dayMs;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      const local = calendar.formatToParts(middle);
      const localYear = Number(local.find(({ type }) => type === 'year')?.value);
      const localMonth = Number(local.find(({ type }) => type === 'month')?.value);
      if (localYear * 12 + localMonth >= firstYear * 12 + firstMonth) high = middle;
      else low = middle;
    }
    return new Date(high);
  }

  return { from: startOfMonth(0), to: startOfMonth(1), timeZone };
}

export function financeInterval(period: ReportPeriod) {
  const days = (period.to.getTime() - period.from.getTime()) / dayMs;
  if (days > 730) return null;
  return days <= 62 ? 'day' : 'month';
}

export function periodJson(period: ReportPeriod) {
  return { from: period.from.toISOString(), to: period.to.toISOString(), timeZone: period.timeZone };
}
