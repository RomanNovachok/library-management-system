import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export function Modal({ title, pending = false, onClose, children }: {
  title: string; pending?: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={ref} aria-labelledby={titleId} aria-busy={pending} onCancel={(event) => {
    event.preventDefault();
    if (!pending) onClose();
  }} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-3xl border border-line bg-white p-5 text-ink shadow-xl backdrop:bg-pine/40 sm:p-8">
    <div className="mb-6 flex items-start justify-between gap-4">
      <h2 id={titleId} className="text-xl font-semibold tracking-tight">{title}</h2>
      <button type="button" onClick={onClose} disabled={pending} aria-label="Закрити вікно" className="-mr-2 -mt-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-xl text-muted hover:bg-sage disabled:cursor-not-allowed disabled:opacity-50">×</button>
    </div>
    {children}
  </dialog>;
}
