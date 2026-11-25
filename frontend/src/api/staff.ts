import { getJson, requestJson } from './client';

export type StaffRole = 'ADMIN' | 'LIBRARIAN';
export interface StaffIdentity { id: string; email: string; role: StaffRole }
export interface StaffAccount extends StaffIdentity { isActive: boolean }
type StaffPatch = Partial<Pick<StaffAccount, 'email' | 'role' | 'isActive'>>;

export const roleLabels: Record<StaffRole, string> = { ADMIN: 'Адміністратор', LIBRARIAN: 'Бібліотекар' };

function isIdentity(value: unknown): value is StaffIdentity {
  return !!value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' &&
    'email' in value && typeof value.email === 'string' && 'role' in value && (value.role === 'ADMIN' || value.role === 'LIBRARIAN');
}

function isAccount(value: unknown): value is StaffAccount {
  return isIdentity(value) && 'isActive' in value && typeof value.isActive === 'boolean';
}

const isAccountList = (value: unknown): value is StaffAccount[] => Array.isArray(value) && value.every(isAccount);

export const currentStaff = (signal: AbortSignal) => getJson('/auth/me', isIdentity, signal);
export const login = (email: string, password: string, signal: AbortSignal) =>
  requestJson('/auth/login', { method: 'POST', body: { email, password }, signal }, isIdentity);
export const logout = (signal: AbortSignal) => requestJson('/auth/logout', { method: 'POST', signal });
export const changePassword = (oldPassword: string, newPassword: string, signal: AbortSignal) =>
  requestJson('/auth/change-password', { method: 'POST', body: { oldPassword, newPassword }, signal });
export const listStaff = (signal: AbortSignal) => getJson('/staff', isAccountList, signal);
export const createStaff = (body: { email: string; role: StaffRole; password: string }, signal: AbortSignal) =>
  requestJson('/staff', { method: 'POST', body, signal }, isAccount);
export const updateStaff = (id: string, body: StaffPatch, signal: AbortSignal) =>
  requestJson(`/staff/${encodeURIComponent(id)}`, { method: 'PATCH', body, signal }, isAccount);
export const resetStaffPassword = (id: string, password: string, signal: AbortSignal) =>
  requestJson(`/staff/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: { password }, signal });
