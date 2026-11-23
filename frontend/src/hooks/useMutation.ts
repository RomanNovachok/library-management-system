import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export function useMutation() {
  const current = useRef<AbortController | undefined>(undefined);
  const uncertain = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => () => {
    current.current?.abort();
    current.current = undefined;
  }, []);

  async function run<T>(operation: (signal: AbortSignal) => Promise<T>, onSuccess: (result: T) => void) {
    // The synchronous lock also covers repeated events before React renders disabled controls.
    if (current.current || uncertain.current) return;
    const controller = new AbortController();
    current.current = controller;
    setPending(true);
    setError(undefined);
    try {
      const result = await operation(controller.signal);
      if (current.current === controller && !controller.signal.aborted) onSuccess(result);
    } catch (cause) {
      if (current.current === controller && !controller.signal.aborted) {
        uncertain.current = cause instanceof ApiError && cause.outcomeUnknown;
        setError(cause instanceof Error ? cause : new Error('Не вдалося виконати операцію.'));
      }
    } finally {
      if (current.current === controller) {
        current.current = undefined;
        setPending(false);
      }
    }
  }

  return { run, pending, error };
}
