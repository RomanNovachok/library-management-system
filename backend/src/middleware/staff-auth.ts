import type { Request, RequestHandler } from 'express';
import type { StaffIdentity } from '../modules/auth/auth.repository.js';
import { AuthService, forbidden, sessionHash, unauthenticated } from '../modules/auth/auth.service.js';
import { ApiError } from '../lib/api-error.js';

export interface StaffLocals {
  staff?: StaffIdentity;
  tokenHash?: string | undefined;
}

export function readSessionHash(req: Request, cookieName: string) {
  const cookies = req.get('Cookie')?.split(';').map((cookie) => cookie.trim()).filter((cookie) => cookie.startsWith(`${cookieName}=`));
  if (cookies?.length !== 1) return undefined;
  const token = cookies[0]!.slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? sessionHash(token) : undefined;
}

export function requireAuth(service: AuthService, cookieName: string): RequestHandler {
  return async (req, res, next) => {
    const locals: StaffLocals = res.locals;
    locals.tokenHash = readSessionHash(req, cookieName);
    locals.staff = await service.authenticate(locals.tokenHash);
    next();
  };
}

export function requireRole(role: StaffIdentity['role'], ...otherRoles: StaffIdentity['role'][]): RequestHandler {
  return (_req, res, next) => {
    const { staff }: StaffLocals = res.locals;
    if (!staff) throw unauthenticated();
    if (staff.role !== role && !otherRoles.includes(staff.role)) throw forbidden();
    next();
  };
}

export function requireCsrf(origin: string): RequestHandler {
  return (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (req.get('Origin') !== origin || req.get('X-Library-Request') !== '1')) {
      throw new ApiError(403, 'CSRF_REJECTED', 'Request origin or CSRF header is invalid');
    }
    next();
  };
}
