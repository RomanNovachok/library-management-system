import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import type { SectionDefinition } from '../types/navigation';

export function SectionPage({ section }: { section: SectionDefinition }) {
  return <>
    <p className="eyebrow">Керування бібліотекою</p>
    <h1 className="page-title">{section.title}</h1>
    <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">{section.description}</p>

    <section aria-labelledby="planned-title" className="mt-8 overflow-hidden rounded-3xl border border-line bg-white">
      <div className="flex flex-col items-center border-b border-line px-6 py-12 text-center sm:py-16">
        <span className="mb-6 flex size-20 items-center justify-center rounded-3xl bg-sage text-pine"><Icon name={section.icon} className="size-9" /></span>
        <span className="mb-4 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">Запланований розділ</span>
        <h2 id="planned-title" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Цей розділ ще готується</h2>
        <p className="mt-3 max-w-md text-sm leading-7 text-muted">Функціонал ще не реалізовано. Тут з’являться інструменти для щоденної роботи працівників бібліотеки.</p>
      </div>
      <div className="p-6 sm:p-8"><h3 className="mb-5 text-xs font-semibold uppercase tracking-wider text-muted">Що буде доступно</h3><ul className="grid gap-4 lg:grid-cols-3">{section.plannedFeatures.map((feature) => <li key={feature} className="flex gap-3 text-sm leading-6 text-ink"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-pine/45" />{feature}</li>)}</ul></div>
    </section>
    <Link to="/dashboard" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-pine hover:underline"><span aria-hidden="true">←</span>Повернутися на головну</Link>
  </>;
}
