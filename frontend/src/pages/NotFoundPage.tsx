import { Link } from 'react-router';

export function NotFoundPage() {
  return <div className="rounded-3xl border border-line bg-white px-6 py-20 text-center">
    <p className="eyebrow">Помилка 404</p><h1 className="page-title">Сторінку не знайдено</h1>
    <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-muted">Перевірте адресу або поверніться до робочого простору бібліотеки.</p>
    <Link to="/dashboard" className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-pine px-5 py-3 text-sm font-medium text-white hover:bg-[#245448]">На головну</Link>
  </div>;
}
