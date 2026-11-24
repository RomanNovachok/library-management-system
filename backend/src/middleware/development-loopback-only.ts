import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  if (address === '::1') return true;
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return isIP(ipv4) === 4 && ipv4.startsWith('127.');
}

// Temporary local development restriction. Replace with authentication + RBAC before deployment.
export function developmentLoopbackOnly(environment: Env['NODE_ENV']): RequestHandler {
  return (req, _res, next) => {
    // Read the actual TCP peer, never req.ip, Forwarded, role headers or proxy headers.
    if (environment !== 'development' || !isLoopback(req.socket.remoteAddress)) {
      next(new ApiError(403, 'ADMIN_ACCESS_FORBIDDEN', 'This operation requires a local loopback connection in development'));
      return;
    }
    next();
  };
}
