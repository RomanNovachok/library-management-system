import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from '../../lib/api-error.js';
import type { AuthRepository, StaffIdentity } from './auth.repository.js';
import { LoginLimit } from './login-limit.js';
import { hashPassword, verifyPassword } from './passwords.js';

export function unauthenticated() {
  return new ApiError(401, 'AUTH_REQUIRED', 'A valid staff session is required');
}

export function forbidden() {
  return new ApiError(403, 'ROLE_FORBIDDEN', 'Your role does not permit this operation');
}

export function sessionHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

const invalidCredentials = () => new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

export class AuthService {
  private readonly limit = new LoginLimit();

  constructor(
    private readonly repository: AuthRepository,
    private readonly sessionTtlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(email: string, password: string, address: string | undefined, previousHash?: string) {
    this.limit.take(email, address, this.now().getTime());
    const account = await this.repository.findByEmail(email);
    const valid = await verifyPassword(password, account?.isActive ? account.passwordHash : undefined);
    if (!valid || !account?.isActive) throw invalidCredentials();

    const token = randomBytes(32).toString('base64url');
    const user = await this.repository.transaction(async (data): Promise<StaffIdentity> => {
      const current = await data.findAccount(account.id);
      if (!current?.isActive || current.email !== email || current.passwordHash !== account.passwordHash || current.role !== account.role) {
        throw invalidCredentials();
      }
      const now = this.now();
      await data.deleteExpiredSessions(now);
      if (previousHash) await data.deleteSession(previousHash);
      await data.createSession({ tokenHash: sessionHash(token), staffUserId: current.id, expiresAt: new Date(now.getTime() + this.sessionTtlMs) });
      return { id: current.id, email: current.email, role: current.role };
    });
    return { user, token };
  }

  async authenticate(tokenHash?: string) {
    const user = tokenHash && await this.repository.authenticate(tokenHash, this.now());
    if (!user) throw unauthenticated();
    return user;
  }

  async logout(tokenHash?: string) {
    if (tokenHash) await this.repository.transaction((data) => data.deleteSession(tokenHash));
  }

  async changePassword(id: string, tokenHash: string, oldPassword: string, newPassword: string) {
    const account = await this.repository.findAccount(id);
    if (!await verifyPassword(oldPassword, account?.passwordHash) || !account) {
      throw new ApiError(400, 'WRONG_OLD_PASSWORD', 'Current password is incorrect');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.repository.transaction(async (data) => {
      const current = await data.authenticate(tokenHash, this.now());
      if (current?.id !== id) throw unauthenticated();
      if ((await data.findAccount(id))?.passwordHash !== account.passwordHash) throw unauthenticated();
      await data.updateAccount(id, { passwordHash });
      await data.deleteAccountSessions(id);
    });
  }
}
