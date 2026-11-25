import { changePassword } from '../../api/staff';
import { useMutation } from '../../hooks/useMutation';
import { Modal } from '../Modal';
import { FormActions, FormFeedback } from './FormFeedback';
import { NewPasswordField } from './NewPasswordField';

export function ChangePasswordForm({ onClose, onSaved, onRefresh }: {
  onClose: () => void;
  onSaved: () => void;
  onRefresh: () => void;
}) {
  const { run, pending, error } = useMutation();
  return <Modal title="Змінити пароль" pending={pending} onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void run((signal) => changePassword(String(data.get('oldPassword')), String(data.get('newPassword')), signal), onSaved);
    }}>
      <FormFeedback error={error} onRefresh={onRefresh} />
      <fieldset disabled={pending} className="grid gap-4">
        <label className="grid gap-2 text-sm font-medium">Поточний пароль
          <input className="form-input" type="password" name="oldPassword" autoComplete="current-password" required maxLength={128} />
        </label>
        <NewPasswordField name="newPassword" />
      </fieldset>
      <p className="mt-4 text-sm text-muted">Після зміни пароля потрібно буде увійти знову.</p>
      <FormActions pending={pending} error={error} submitLabel="Змінити пароль" onCancel={onClose} />
    </form>
  </Modal>;
}
