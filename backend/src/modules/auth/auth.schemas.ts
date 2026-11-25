import { z } from 'zod';
import { ApiError } from '../../lib/api-error.js';

export const staffEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().min(1).max(128);
export const newPassword = password.refine((value) => {
  return Array.from(value).length >= 12 && !/\p{Cc}/u.test(value) && /\p{L}/u.test(value) && /[^\p{L}\s]/u.test(value);
});

export const loginBody = z.strictObject({ email: staffEmail, password });
export const changePasswordBody = z.strictObject({ oldPassword: password, newPassword });

export function parseAuthInput<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'AUTH_VALIDATION_ERROR', 'Invalid account details or password policy violation');
  return result.data;
}
