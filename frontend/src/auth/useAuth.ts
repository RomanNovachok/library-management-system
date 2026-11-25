import { createContext, useContext } from 'react';
import type { StaffIdentity } from '../api/staff';

type AuthState =
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: StaffIdentity };

export const AuthContext = createContext<{
  state: AuthState;
  setUser: (user: StaffIdentity | undefined) => void;
  retry: () => void;
} | null>(null);

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider is required');
  return auth;
}
