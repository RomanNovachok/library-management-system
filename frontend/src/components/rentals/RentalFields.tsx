import type { ReactNode } from 'react';

export function RentalFields({ fields }: { fields: [string, ReactNode][] }) {
  return <dl className="grid grid-cols-1 gap-x-5 gap-y-4 text-sm sm:grid-cols-2">
    {fields.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="text-muted">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd>
    </div>)}
  </dl>;
}
