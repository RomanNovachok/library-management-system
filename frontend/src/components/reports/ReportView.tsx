import { Link, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { detailLink } from '../../utils/detail-navigation';

export function ReportLink({ to, children }: { to: string; children: ReactNode }) {
  const location = useLocation();
  return <Link {...detailLink(location, to)} className="font-medium text-pine underline-offset-4 hover:underline">{children}</Link>;
}

export function Metrics({ values }: { values: readonly (readonly [string, ReactNode])[] }) {
  return <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
    {values.map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border border-line bg-white p-4">
      <dt className="text-sm leading-5 text-muted">{label}</dt>
      <dd className="mt-2 break-words text-xl font-semibold tabular-nums text-pine sm:text-2xl">{value}</dd>
    </div>)}
  </dl>;
}

export function ReportPanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-2xl border border-line bg-white p-4 sm:p-6">
    <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
    {description && <p className="mb-4 text-sm text-muted">{description}</p>}
    {children}
  </section>;
}

export function ReportTable({ title, columns, rows, empty }: {
  title: string; columns: readonly string[]; rows: { id: string; cells: ReactNode[] }[]; empty: string;
}) {
  if (!rows.length) return <p className="rounded-xl bg-surface p-5 text-center text-sm text-muted">{empty}</p>;
  return <div className="overflow-x-auto rounded-xl border border-line" role="region" aria-label={title} tabIndex={0}>
    <table className="w-full text-left text-sm">
      <thead className="bg-surface text-xs text-muted"><tr>
        {columns.map((column) => <th key={column} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{column}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-line">
        {rows.map(({ id, cells }) => <tr key={id} className="align-top">
          {cells.map((cell, index) => <td key={columns[index]} className="px-4 py-3">{cell}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

