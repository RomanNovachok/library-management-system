import { useId } from 'react';

export function NewPasswordField({ name = 'password' }: { name?: string }) {
  const hintId = useId();
  return <div>
    <label className="grid gap-2 text-sm font-medium">Новий пароль
      <input className="form-input" type="password" name={name} autoComplete="new-password" required
        minLength={12} maxLength={128} pattern={'(?=.*\\p{L})(?=.*[^\\p{L}\\s])[^\\p{Cc}]{12,128}'} aria-describedby={hintId} />
    </label>
    <p id={hintId} className="mt-2 text-xs text-muted">12–128 символів, щонайменше одна літера та цифра або спеціальний символ.</p>
  </div>;
}
