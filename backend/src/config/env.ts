import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(604800).default(28800),
  SESSION_COOKIE_SAME_SITE: z.enum(['lax', 'none']).default('lax'),
  LOGIN_BEHIND_PROXY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CORS_ORIGIN: z.string().trim().refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
    } catch {
      return false;
    }
  }, 'Must be an HTTP(S) origin without a path or trailing slash'),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production' && !value.CORS_ORIGIN.startsWith('https://')) {
    ctx.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: 'Production requires an HTTPS origin' });
  }
  if (value.SESSION_COOKIE_SAME_SITE === 'none' && value.NODE_ENV !== 'production') {
    ctx.addIssue({ code: 'custom', path: ['SESSION_COOKIE_SAME_SITE'], message: 'SameSite=None requires HTTPS production cookies' });
  }
});

export function readEnv(environment: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}

export type Env = z.infer<typeof envSchema>;
