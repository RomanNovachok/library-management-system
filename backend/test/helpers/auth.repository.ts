import { randomBytes, randomUUID } from 'node:crypto';
import type { AuthRepository, AuthWriteData, StaffAccount } from '../../src/modules/auth/auth.repository.js';
import { sessionHash } from '../../src/modules/auth/auth.service.js';
import { ApiError } from '../../src/lib/api-error.js';

type Account = StaffAccount & { passwordHash: string };
type Session = Parameters<AuthWriteData['createSession']>[0];

function publicAccount({ id, email, role, isActive }: Account): StaffAccount {
  return { id, email, role, isActive };
}

export class MemoryAuthRepository implements AuthRepository, AuthWriteData {
  private accounts = new Map<string, Account>();
  readonly sessions = new Map<string, Session>();
  private writes = Promise.resolve();

  async transaction<T>(operation: (data: AuthWriteData) => Promise<T>) {
    const result = this.writes.then(async () => {
      const accounts = new Map(this.accounts);
      const sessions = new Map(this.sessions);
      try { return await operation(this); }
      catch (error) {
        this.accounts = accounts;
        this.sessions.clear();
        for (const [key, value] of sessions) this.sessions.set(key, value);
        throw error;
      }
    });
    this.writes = result.then(() => {}, () => {});
    return result;
  }

  async findByEmail(email: string) {
    return [...this.accounts.values()].find((account) => account.email === email) ?? null;
  }

  async findAccount(id: string) {
    return this.accounts.get(id) ?? null;
  }

  async authenticate(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) return null;
    const account = this.accounts.get(session.staffUserId);
    return account?.isActive ? { id: account.id, email: account.email, role: account.role } : null;
  }

  async listAccounts() {
    return [...this.accounts.values()].map(publicAccount);
  }

  async countActiveAdmins() {
    return [...this.accounts.values()].filter((account) => account.role === 'ADMIN' && account.isActive).length;
  }

  async createAccount(data: Parameters<AuthWriteData['createAccount']>[0]) {
    if (await this.findByEmail(data.email)) throw new ApiError(409, 'STAFF_EMAIL_EXISTS', 'Email is already in use');
    const account = { ...data, id: randomUUID(), isActive: true };
    this.accounts.set(account.id, account);
    return publicAccount(account);
  }

  async updateAccount(id: string, data: Parameters<AuthWriteData['updateAccount']>[1]) {
    const account = this.accounts.get(id)!;
    const existing = data.email && await this.findByEmail(data.email);
    if (existing && existing.id !== id) throw new ApiError(409, 'STAFF_EMAIL_EXISTS', 'Email is already in use');
    const updated = { ...account, ...data };
    this.accounts.set(id, updated);
    return publicAccount(updated);
  }

  async createSession(data: Session) {
    this.sessions.set(data.tokenHash, data);
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async deleteAccountSessions(staffUserId: string) {
    for (const [key, session] of this.sessions) {
      if (session.staffUserId === staffUserId) this.sessions.delete(key);
    }
  }

  async deleteExpiredSessions(now: Date) {
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }
}

export async function requestSession(role: StaffAccount['role'] = 'ADMIN', secure = false) {
  const repository = new MemoryAuthRepository();
  const account = await repository.createAccount({ email: 'fixture@example.test', role, passwordHash: 'disabled-fixture-login' });
  const token = randomBytes(32).toString('base64url');
  await repository.createSession({ tokenHash: sessionHash(token), staffUserId: account.id, expiresAt: new Date(Date.now() + 3600_000) });
  return { repository, cookie: `${secure ? '__Secure-' : ''}library_session=${token}` };
}

export function staffRequestHeaders(origin: string, cookie?: string) {
  return { 'Content-Type': 'application/json', Origin: origin, 'X-Library-Request': '1', ...(cookie && { Cookie: cookie }) };
}
