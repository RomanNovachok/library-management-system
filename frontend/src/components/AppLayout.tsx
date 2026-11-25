import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { sections } from '../pages/sections';
import { Icon } from './Icon';
import { logout, roleLabels } from '../api/staff';
import { useAuth } from '../auth/useAuth';
import { useMutation } from '../hooks/useMutation';
import { ChangePasswordForm } from './forms/ChangePasswordForm';
import { FormFeedback } from './forms/FormFeedback';

function Navigation() {
  const { state } = useAuth();
  const admin = state.status === 'authenticated' && state.user.role === 'ADMIN';
  return <nav aria-label="Основна навігація" className="grid gap-1">
    {sections.filter((section) => admin || section.path !== '/administration').map((section) => (
      <NavLink key={section.path} to={section.path} end={!['/books', '/readers'].includes(section.path)} className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${isActive ? 'bg-white/12 text-white' : 'text-emerald-50/75 hover:bg-white/7 hover:text-white'}`}>
        <Icon name={section.icon} /><span>{section.title}</span>
      </NavLink>
    ))}
  </nav>;
}

function Brand() {
  return <Link to="/dashboard" aria-label="Бібліотека — на головну" className="flex w-fit items-center gap-3 rounded-lg">
    <span className="flex size-11 items-center justify-center rounded-xl bg-white/10 text-emerald-100"><Icon name="books" className="size-6" /></span>
    <span><span className="block text-lg font-semibold tracking-tight text-white">Бібліотека</span><span className="block text-xs text-emerald-100/65">Робочий простір</span></span>
  </Link>;
}

function SessionControls() {
  const { state, setUser, retry } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  const { run, pending, error } = useMutation();
  if (state.status !== 'authenticated') return null;
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      <div className="min-w-0 text-right text-sm">
        <p className="break-all font-medium">{state.user.email}</p>
        <p className="text-xs text-muted">{roleLabels[state.user.role]}</p>
      </div>
      <button type="button" className="button-secondary" disabled={pending} onClick={() => setChangingPassword(true)}>Змінити пароль</button>
      <button type="button" className="button-secondary" disabled={pending} onClick={() => {
        void run(logout, () => setUser(undefined));
      }}>{pending ? 'Виходимо…' : 'Вийти'}</button>
    </div>
    <FormFeedback error={error} onRefresh={retry} />
    {changingPassword && <ChangePasswordForm onClose={() => setChangingPassword(false)} onSaved={() => setUser(undefined)} onRefresh={retry} />}
  </div>;
}

export function AppLayout() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const activeSection = sections.find((section) => section.path === pathname || (['/books', '/readers'].includes(section.path) && pathname.startsWith(`${section.path}/`)));

  useEffect(() => {
    document.title = `${activeSection?.title ?? 'Сторінку не знайдено'} — Бібліотека`;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname, activeSection?.title]);

  return <div className="min-h-dvh lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
    <a href="#main-content" className="skip-link">Перейти до вмісту</a>
    <aside className="hidden bg-pine px-5 py-8 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
      <div className="px-3"><Brand /></div>
      <p className="mb-3 mt-12 px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/50">Керування бібліотекою</p>
      <Navigation />
      <div className="mt-auto px-4 pt-10 text-xs leading-5 text-emerald-100/65">
        <p className="mb-1 font-medium text-emerald-50/90">Для працівників бібліотеки</p>
        <p>Облік фонду та щоденна робота з читачами.</p>
      </div>
    </aside>

    <div className="flex min-h-dvh min-w-0 flex-col">
      <header className="border-b border-line bg-white/80">
        <div className="flex min-h-20 flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8 lg:px-12">
          <p className="text-sm text-muted"><span className="hidden sm:inline">Бібліотека <span className="mx-3 text-slate-300">/</span></span><span className="font-medium text-ink">{activeSection?.title ?? 'Сторінку не знайдено'}</span></p>
          <SessionControls />
        </div>
        <details key={pathname} className="group mx-4 mb-4 rounded-2xl bg-pine p-3 lg:hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 text-white [&::-webkit-details-marker]:hidden"><Brand /><span className="flex items-center gap-2 text-sm"><span>Меню</span><Icon name="menu" /></span></summary>
          <div className="pt-4"><Navigation /></div>
        </details>
      </header>

      <main id="main-content" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-8 outline-none sm:px-8 sm:py-10 lg:px-12 lg:py-12">
        <Outlet />
      </main>
      <footer className="mx-5 flex flex-wrap justify-between gap-2 border-t border-line py-6 text-xs text-muted sm:mx-8 lg:mx-12">
        <span>Library Management System</span>
      </footer>
    </div>
  </div>;
}
