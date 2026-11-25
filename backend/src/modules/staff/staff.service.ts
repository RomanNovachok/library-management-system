import { ApiError } from '../../lib/api-error.js';
import type { AuthRepository, AuthWriteData, StaffPatch } from '../auth/auth.repository.js';
import { forbidden, unauthenticated } from '../auth/auth.service.js';
import { hashPassword } from '../auth/passwords.js';

export class StaffService {
  constructor(private readonly repository: AuthRepository, private readonly now: () => Date = () => new Date()) {}

  list() {
    return this.repository.listAccounts();
  }

  async create(tokenHash: string, email: string, role: 'ADMIN' | 'LIBRARIAN', password: string) {
    const passwordHash = await hashPassword(password);
    return this.repository.transaction(async (data) => {
      await this.requireAdmin(data, tokenHash);
      return data.createAccount({ email, role, passwordHash });
    });
  }

  async bootstrap(email: string, password: string) {
    const passwordHash = await hashPassword(password);
    return this.repository.transaction(async (data) => {
      if (await data.countActiveAdmins()) {
        throw new ApiError(409, 'ADMIN_ALREADY_EXISTS', 'An active administrator already exists');
      }
      return data.createAccount({ email, role: 'ADMIN', passwordHash });
    });
  }

  async update(tokenHash: string, id: string, patch: StaffPatch) {
    return this.repository.transaction(async (data) => {
      await this.requireAdmin(data, tokenHash);
      const account = await data.findAccount(id);
      if (!account) throw this.notFound();
      const role = patch.role ?? account.role;
      const isActive = patch.isActive ?? account.isActive;
      if (account.role === 'ADMIN' && account.isActive && (role !== 'ADMIN' || !isActive) && await data.countActiveAdmins() <= 1) {
        throw new ApiError(409, 'LAST_ACTIVE_ADMIN', 'At least one active administrator is required');
      }
      const updated = await data.updateAccount(id, patch);
      if (role !== account.role || isActive !== account.isActive) await data.deleteAccountSessions(id);
      return updated;
    });
  }

  async resetPassword(tokenHash: string, id: string, password: string) {
    const passwordHash = await hashPassword(password);
    await this.repository.transaction(async (data) => {
      await this.requireAdmin(data, tokenHash);
      if (!await data.findAccount(id)) throw this.notFound();
      await data.updateAccount(id, { passwordHash });
      await data.deleteAccountSessions(id);
    });
  }

  private async requireAdmin(data: AuthWriteData, tokenHash: string) {
    const actor = await data.authenticate(tokenHash, this.now());
    if (!actor) throw unauthenticated();
    if (actor.role !== 'ADMIN') throw forbidden();
  }

  private notFound() {
    return new ApiError(404, 'STAFF_NOT_FOUND', 'Staff account not found');
  }
}
