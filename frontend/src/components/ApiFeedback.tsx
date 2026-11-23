import { Icon } from './Icon';

export function LoadingState({ message }: { message: string }) {
  return <div role="status" className="flex items-center justify-center gap-3 rounded-3xl border border-line bg-white px-6 py-16 text-sm text-muted">
    <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-line border-t-pine motion-reduce:animate-none" />
    {message}
  </div>;
}

export function ErrorState({ error, retry, title = 'Не вдалося завантажити дані' }: { error: Error; retry: () => void; title?: string }) {
  return <div role="alert" className="rounded-3xl border border-amber-200 bg-white px-6 py-12 text-center">
    <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-900"><Icon name="books" className="size-7" /></span>
    <h2 className="text-xl font-semibold text-ink">{title}</h2>
    <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-muted">{error.message}</p>
    <button type="button" onClick={retry} className="mt-6 min-h-11 cursor-pointer rounded-xl bg-pine px-5 py-3 text-sm font-medium text-white hover:bg-[#245448]">Спробувати ще раз</button>
  </div>;
}
