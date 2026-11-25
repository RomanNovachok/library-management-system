import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../lib/api-error.js';

const settings = { N: 2 ** 15, r: 8, p: 3, maxmem: 40 * 1024 * 1024 };
const format = 'scrypt-v1';
// Unknown and inactive accounts perform the same derivation as known accounts.
const dummyHash = `${format}:${randomBytes(16).toString('hex')}:${randomBytes(64).toString('hex')}`;
let pending = 0;

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (pending >= 4) throw new ApiError(503, 'AUTH_BUSY', 'Authentication is busy. Try again shortly.');
  pending++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, settings, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally {
    pending--;
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${format}:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash?: string) {
  const supported = storedHash !== undefined && /^scrypt-v1:[0-9a-f]{32}:[0-9a-f]{128}$/.test(storedHash);
  const [, salt, expected] = (supported ? storedHash : dummyHash).split(':') as [string, string, string];
  const actual = await derive(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(actual, Buffer.from(expected, 'hex')) && supported;
}
