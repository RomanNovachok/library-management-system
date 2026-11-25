import { useState, type FormEvent } from 'react';
import { calendarRange, reportPresets, utcRange, type Preset } from '../../utils/report-period';

export function PeriodFilter({ preset, dates, change }: {
  preset: Preset; dates: { fromDate: string; toDate: string }; change: (values: Record<string, string>) => void;
}) {
  function select(value: string) {
    const initial = dates.fromDate && dates.toDate ? dates : calendarRange('month', new Date());
    change({ period: value === 'month' ? '' : value,
      fromDate: value === 'custom' ? initial.fromDate : '', toDate: value === 'custom' ? initial.toDate : '' });
  }
  return <div className="flex flex-wrap items-end gap-4">
    <label className="block text-sm font-medium">Період
      <select className="form-input mt-2" value={preset} onChange={(event) => select(event.target.value)}>
        {reportPresets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {preset === 'custom' && <CustomPeriod key={`${dates.fromDate}/${dates.toDate}`} dates={dates} change={change} />}
  </div>;
}

function CustomPeriod({ dates, change }: {
  dates: { fromDate: string; toDate: string }; change: (values: Record<string, string>) => void;
}) {
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fromDate = String(form.get('fromDate'));
    const toDate = String(form.get('toDate'));
    if (!utcRange(fromDate, toDate)) { setInvalid(true); return; }
    setInvalid(false);
    change({ fromDate, toDate });
  }

  return <form className="flex flex-wrap items-end gap-4" onSubmit={submit} onChange={() => setInvalid(false)}>
    <label className="block text-sm font-medium">Від
      <input className="form-input mt-2" type="date" name="fromDate" defaultValue={dates.fromDate} min="0001-01-01" max="9999-12-30" required />
    </label>
    <label className="block text-sm font-medium">До включно
      <input className="form-input mt-2" type="date" name="toDate" defaultValue={dates.toDate} min="0001-01-01" max="9999-12-30" required />
    </label>
    <button className="button-secondary">Застосувати період</button>
    {invalid && <p role="alert" className="basis-full text-sm text-red-700">Перевірте дати. Початкова дата має бути раніше або збігатися з кінцевою.</p>}
  </form>;
}
