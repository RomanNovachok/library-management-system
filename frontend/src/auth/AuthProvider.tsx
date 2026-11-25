import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, sessionEvents } from '../api/client';
import { currentStaff, type StaffIdentity } from '../api/staff';
import { AuthContext } from './useAuth';
import { ErrorState, LoadingState } from '../components/ApiFeedback';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ user?: StaffIdentity; error?: Error }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const expired = () => setSession({});
    sessionEvents.addEventListener('expired', expired);
    currentStaff(controller.signal)
      .then((user) => { if (!controller.signal.aborted) setSession({ user }); })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setSession(error instanceof ApiError && error.status === 401 ? {} : { error });
      });
    return () => {
      controller.abort();
      sessionEvents.removeEventListener('expired', expired);
    };
  }, [attempt]);

  if (!session || session.error) return <main className="mx-auto max-w-lg px-5 py-16">
    {session?.error
      ? <ErrorState title="Не вдалося перевірити сеанс" error={session.error} retry={() => { setSession(undefined); setAttempt((value) => value + 1); }} />
      : <LoadingState message="Перевіряємо сеанс…" />}
  </main>;

  return <AuthContext.Provider value={{
    state: session.user ? { status: 'authenticated', user: session.user } : { status: 'anonymous' },
    setUser: (user) => setSession({ user }),
    retry: () => { setSession(undefined); setAttempt((value) => value + 1); },
  }}>{children}</AuthContext.Provider>;
}
