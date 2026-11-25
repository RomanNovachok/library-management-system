import { Navigate, useLocation } from 'react-router';
import { ApiError } from '../api/client';
import { login } from '../api/staff';
import { useAuth } from '../auth/useAuth';
import { Icon } from '../components/Icon';
import { useMutation } from '../hooks/useMutation';

export function LoginPage() {
  const { state, setUser, retry } = useAuth();
  const { state: navigation } = useLocation();
  const { run, pending, error } = useMutation();
  const from: unknown = navigation?.from;
  const destination = typeof from === 'string' && /^\/(?![/\\])/.test(from) && !from.includes('\\') ? from : '/dashboard';
  if (state.status === 'authenticated') return <Navigate to={destination} replace />;
  const uncertain = error instanceof ApiError && error.outcomeUnknown;

  return <main className="mx-auto grid min-h-dvh max-w-lg content-center px-5 py-10">
    <section className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-9">
      <span className="mb-5 grid size-12 place-items-center rounded-xl bg-sage text-pine"><Icon name="books" /></span>
      <h1 className="page-title">Вхід до бібліотеки</h1>
      <form className="mt-7 grid gap-4" aria-busy={pending} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void run((signal) => login(String(data.get('email')), String(data.get('password')), signal), setUser);
      }}>
        <label className="grid gap-2 text-sm font-medium">Електронна адреса
          <input className="form-input" type="email" name="email" autoComplete="username" required maxLength={254} disabled={pending} />
        </label>
        <label className="grid gap-2 text-sm font-medium">Пароль
          <input className="form-input" type="password" name="password" autoComplete="current-password" required maxLength={128} disabled={pending} />
        </label>
        {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{error.message}</p>}
        {uncertain
          ? <button type="button" className="button-secondary" onClick={retry}>Перевірити сеанс</button>
          : <button type="submit" className="button-primary" disabled={pending}>{pending ? 'Входимо…' : 'Увійти'}</button>}
      </form>
    </section>
  </main>;
}
