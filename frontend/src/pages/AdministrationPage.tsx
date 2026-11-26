import { useState } from 'react';
import { listStaff, roleLabels } from '../api/staff';
import { useAuth } from '../auth/useAuth';
import { ErrorState, LoadingState } from '../components/ApiFeedback';
import { AdministrationSettings } from '../components/AdministrationSettings';
import { StaffForm, type StaffDialog } from '../components/forms/StaffForm';
import { useApiResource } from '../hooks/useApiResource';

export function AdministrationPage() {
  const { state, setUser, retry: checkSession } = useAuth();
  const { resource, retry } = useApiResource(listStaff);
  const [dialog, setDialog] = useState<StaffDialog>();
  const [notice, setNotice] = useState('');

  return <>
    <h1 className="page-title">Адміністрування</h1>
    <section className="mt-7 rounded-3xl border border-line bg-white p-5 sm:p-7" aria-labelledby="staff-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="staff-title" className="text-xl font-semibold">Працівники</h2>
        <button type="button" className="button-primary" onClick={() => setDialog({ kind: 'create' })}>Додати працівника</button>
      </div>
      {notice && <p role="status" className="mb-4 text-sm text-pine">{notice}</p>}
      {resource.status === 'loading' && <LoadingState message="Завантажуємо працівників…" />}
      {resource.status === 'error' && <ErrorState error={resource.error} retry={retry} />}
      {resource.status === 'success' && <ul className="divide-y divide-line">
        {resource.data.map((account) => <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <p className="break-all font-medium">{account.email}</p>
            <p className="mt-1 text-sm text-muted">{roleLabels[account.role]} · {account.isActive ? 'Активний' : 'Неактивний'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="button-secondary" onClick={() => setDialog({ kind: 'edit', account })}>Редагувати</button>
            <button type="button" className="button-secondary" onClick={() => setDialog({ kind: 'reset', account })}>Встановити пароль</button>
          </div>
        </li>)}
      </ul>}
    </section>
    <AdministrationSettings checkSession={checkSession} />
    {dialog && <StaffForm dialog={dialog} onClose={() => setDialog(undefined)} onRefresh={checkSession} onSaved={(account) => {
      if (dialog.kind !== 'create' && state.status === 'authenticated' && state.user.id === dialog.account.id) {
        if (!account?.isActive || state.user.role !== account.role) setUser(undefined);
        else setUser({ id: account.id, email: account.email, role: account.role });
      }
      setNotice(dialog.kind === 'reset' ? 'Пароль змінено.' : 'Обліковий запис збережено.');
      setDialog(undefined);
      retry();
    }} />}
  </>;
}
