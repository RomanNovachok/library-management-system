import type { ReactNode } from 'react';
import { useMutation } from '../../hooks/useMutation';
import { Modal } from '../Modal';
import { FormActions, FormFeedback } from './FormFeedback';

export function ConfirmAction({ title, children, label, action, onClose, onSuccess, onRefresh }: {
  title: string; children: ReactNode; label: string; action: (signal: AbortSignal) => Promise<void>;
  onClose: () => void; onSuccess: () => void; onRefresh: () => void;
}) {
  const { run, pending, error } = useMutation();
  return <Modal title={title} pending={pending} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); void run(action, onSuccess); }}>
      <FormFeedback error={error} onRefresh={onRefresh} />
      <div className="break-words text-sm leading-7 text-muted">{children}</div>
      <FormActions pending={pending} error={error} submitLabel={label} danger onCancel={onClose} />
    </form>
  </Modal>;
}
