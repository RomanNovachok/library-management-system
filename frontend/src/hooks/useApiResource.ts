import { useEffect, useState } from 'react';

type Resource<T> = { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: Error };

export function useApiResource<T>(load: (signal: AbortSignal) => Promise<T>, delay = 0) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    load: typeof load;
    attempt: number;
    resource: Resource<T>;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      load(controller.signal).then(
        (data) => {
          if (!controller.signal.aborted) setResult({ load, attempt, resource: { status: 'success', data } });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setResult({ load, attempt, resource: { status: 'error', error: error instanceof Error ? error : new Error('Не вдалося завантажити дані.') } });
          controller.abort();
        },
      );
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, attempt, delay]);

  // Hide the previous request immediately, including the render before effect cleanup.
  const resource: Resource<T> = result?.load === load && result.attempt === attempt ? result.resource : { status: 'loading' };
  return { resource, retry: () => setAttempt((value) => value + 1) };
}
