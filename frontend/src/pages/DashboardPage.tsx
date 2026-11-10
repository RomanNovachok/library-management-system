import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { sections } from './sections';

export function DashboardPage() {
  return <>
    <div className="mb-8">
      <p className="eyebrow">Головна</p>
      <h1 className="page-title">Робочий простір</h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted sm:text-base">Книги, читачі та щоденні справи бібліотеки — в одному місці.</p>
    </div>

    <section aria-labelledby="welcome-title" className="relative mb-10 overflow-hidden rounded-3xl border border-[#d9e6de] bg-[#eaf2ec] p-6 sm:p-9 lg:p-10">
      <div className="relative z-10 max-w-xl sm:pr-24">
        <span className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-pine"><span className="h-px w-6 bg-pine/45" />Вітаємо в бібліотеці</span>
        <h2 id="welcome-title" className="text-2xl font-semibold leading-tight tracking-tight text-pine sm:text-3xl">Місце, де кожна книга<br className="hidden sm:block" /> має свою історію.</h2>
        <p className="mt-4 max-w-md text-sm leading-7 text-[#50675d]">Оберіть потрібний розділ, щоб ознайомитися зі структурою системи. Робочі можливості з’являтимуться поступово.</p>
        <Link to="/books" className="mt-6 inline-flex min-h-11 items-center gap-3 rounded-xl bg-pine px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#245448]">Перейти до розділу книг<Icon name="arrow" className="size-4" /></Link>
      </div>
      <svg viewBox="0 0 220 200" className="absolute -right-6 bottom-0 hidden h-52 w-56 text-pine/20 xl:block" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="120" cy="120" r="85" strokeDasharray="4 8" /><rect x="45" y="55" width="35" height="125" rx="5" fill="#c4d8ca" /><rect x="85" y="35" width="40" height="145" rx="5" fill="#aecab9" /><path d="m138 59 28-8 34 119-28 8z" fill="#d3ddba" /><path d="M53 79h19M53 86h19M93 62h24M93 69h24M99 155h13M54 161h17M37 182h173" /></svg>
    </section>

    <section aria-labelledby="sections-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2"><h2 id="sections-title" className="text-lg font-semibold tracking-tight text-ink">Розділи системи</h2><p className="text-xs text-muted">Швидкий перехід до робочих розділів</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.filter((section) => section.path !== '/dashboard').map((section) => (
          <Link key={section.path} to={section.path} className="group rounded-2xl border border-line bg-white p-6 transition-colors hover:border-pine/35 hover:bg-[#fcfdfb]">
            <div className="mb-6 flex items-center justify-between"><span className="flex size-11 items-center justify-center rounded-xl bg-sage text-pine"><Icon name={section.icon} className="size-6" /></span><Icon name="arrow" className="size-4 text-muted transition-transform group-hover:translate-x-1 motion-reduce:transform-none" /></div>
            <h3 className="text-base font-semibold text-ink">{section.title}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-muted">{section.description}</p><span className="mt-5 inline-flex rounded-md bg-surface px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted">Заплановано</span>
          </Link>
        ))}
        <div className="flex flex-col justify-center rounded-2xl border border-dashed border-[#d4dfd7] px-6 py-7">
          <p className="text-sm font-medium text-ink">Система на етапі створення</p><p className="mt-3 text-sm leading-6 text-muted">Це основа майбутнього робочого інтерфейсу. Дані бібліотеки та операції ще не підключені.</p>
        </div>
      </div>
    </section>
  </>;
}
