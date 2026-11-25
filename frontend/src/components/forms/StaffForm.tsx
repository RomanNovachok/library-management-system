import { createStaff, resetStaffPassword, roleLabels, updateStaff, type StaffAccount, type StaffRole } from '../../api/staff';
import { useMutation } from '../../hooks/useMutation';
import { Modal } from '../Modal';
import { FormActions, FormFeedback } from './FormFeedback';
import { NewPasswordField } from './NewPasswordField';

export type StaffDialog = { kind: 'create' } | { kind: 'edit' | 'reset'; account: StaffAccount };

export function StaffForm({ dialog, onClose, onSaved, onRefresh }: {
  dialog: StaffDialog;
  onClose: () => void;
  onSaved: (account?: StaffAccount) => void;
  onRefresh: () => void;
}) {
  const { run, pending, error } = useMutation();
  const title = dialog.kind === 'create' ? 'Додати працівника' : dialog.kind === 'edit' ? 'Редагувати працівника' : 'Встановити новий пароль';
  const account = dialog.kind === 'create' ? undefined : dialog.account;
  return <Modal title={title} pending={pending} onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      if (dialog.kind === 'reset') {
        void run((signal) => resetStaffPassword(dialog.account.id, String(data.get('password')), signal), () => onSaved());
        return;
      }
      const email = String(data.get('email')).trim().toLowerCase();
      const role = data.get('role') as StaffRole;
      if (dialog.kind === 'create') {
        void run((signal) => createStaff({ email, role, password: String(data.get('password')) }, signal), onSaved);
        return;
      }
      const isActive = data.get('isActive') === 'on';
      const patch = {
        ...(email !== dialog.account.email && { email }),
        ...(role !== dialog.account.role && { role }),
        ...(isActive !== dialog.account.isActive && { isActive }),
      };
      if (!Object.keys(patch).length) { onClose(); return; }
      void run((signal) => updateStaff(dialog.account.id, patch, signal), onSaved);
    }}>
      <FormFeedback error={error} onRefresh={onRefresh} />
      <fieldset disabled={pending} className="grid gap-4">
        {dialog.kind === 'reset' ? <p className="break-all text-sm text-muted">{dialog.account.email}</p> : <>
          <label className="grid gap-2 text-sm font-medium">Електронна адреса
            <input className="form-input" type="email" name="email" defaultValue={account?.email} required maxLength={254} />
          </label>
          <label className="grid gap-2 text-sm font-medium">Роль
            <select className="form-input" name="role" defaultValue={account?.role ?? 'LIBRARIAN'}>
              {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </>}
        {dialog.kind === 'edit'
          ? <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="isActive" defaultChecked={dialog.account.isActive} />Активний обліковий запис</label>
          : <NewPasswordField />}
      </fieldset>
      {dialog.kind === 'reset' && <p className="mt-4 text-sm text-muted">Зміна пароля завершить усі сеанси працівника.</p>}
      <FormActions pending={pending} error={error} submitLabel={dialog.kind === 'create' ? 'Створити обліковий запис' : 'Зберегти зміни'} onCancel={onClose} />
    </form>
  </Modal>;
}
