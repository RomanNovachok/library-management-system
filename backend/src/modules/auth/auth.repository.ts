import { Prisma } from '../../generated/prisma/client.ts';
import type { StaffRole } from '../../generated/prisma/enums.ts';
import { ApiError } from '../../lib/api-error.js';

export interface StaffIdentity {
  id: string;
  email: string;
  role: StaffRole;
}

export interface StaffAccount extends StaffIdentity {
  isActive: boolean;
}

interface StaffCredentials extends StaffAccount {
  passwordHash: string;
}

export type StaffPatch = Partial<Pick<StaffAccount, 'email' | 'role' | 'isActive'>>;

export interface AuthData {
  findByEmail(email: string): Promise<StaffCredentials | null>;
  findAccount(id: string): Promise<StaffCredentials | null>;
  authenticate(tokenHash: string, now: Date): Promise<StaffIdentity | null>;
  listAccounts(): Promise<StaffAccount[]>;
}

export interface AuthWriteData extends AuthData {
  countActiveAdmins(): Promise<number>;
  createAccount(data: Pick<StaffCredentials, 'email' | 'role' | 'passwordHash'>): Promise<StaffAccount>;
  updateAccount(id: string, data: StaffPatch & { passwordHash?: string }): Promise<StaffAccount>;
  createSession(data: { tokenHash: string; staffUserId: string; expiresAt: Date }): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteAccountSessions(staffUserId: string): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<void>;
}

export interface AuthRepository extends AuthData {
  transaction<T>(operation: (data: AuthWriteData) => Promise<T>): Promise<T>;
}

const identityFields = { id: true, email: true, role: true } as const;
const accountFields = { ...identityFields, isActive: true } as const;

class PrismaAuthData implements AuthWriteData {
  constructor(private readonly connection?: Prisma.TransactionClient) {}

  private async db() {
    return this.connection ?? (await import('../../lib/prisma.js')).prisma;
  }

  async findByEmail(email: string) {
    return (await this.db()).staffUser.findUnique({ where: { email } });
  }

  async findAccount(id: string) {
    return (await this.db()).staffUser.findUnique({ where: { id } });
  }

  async authenticate(tokenHash: string, now: Date) {
    const session = await (await this.db()).staffSession.findFirst({
      where: { tokenHash, expiresAt: { gt: now }, staffUser: { isActive: true } },
      select: { staffUser: { select: identityFields } },
    });
    return session?.staffUser ?? null;
  }

  async listAccounts() {
    return (await this.db()).staffUser.findMany({ select: accountFields, orderBy: { email: 'asc' } });
  }

  async countActiveAdmins() {
    return (await this.db()).staffUser.count({ where: { role: 'ADMIN', isActive: true } });
  }

  async createAccount(data: Parameters<AuthWriteData['createAccount']>[0]) {
    return (await this.db()).staffUser.create({ data, select: accountFields });
  }

  async updateAccount(id: string, data: Parameters<AuthWriteData['updateAccount']>[1]) {
    return (await this.db()).staffUser.update({ where: { id }, data, select: accountFields });
  }

  async createSession(data: Parameters<AuthWriteData['createSession']>[0]) {
    await (await this.db()).staffSession.create({ data });
  }

  async deleteSession(tokenHash: string) {
    await (await this.db()).staffSession.deleteMany({ where: { tokenHash } });
  }

  async deleteAccountSessions(staffUserId: string) {
    await (await this.db()).staffSession.deleteMany({ where: { staffUserId } });
  }

  async deleteExpiredSessions(now: Date) {
    await (await this.db()).staffSession.deleteMany({ where: { expiresAt: { lte: now } } });
  }
}

type TransactionRunner = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export class PrismaAuthRepository extends PrismaAuthData implements AuthRepository {
  constructor(connection?: Prisma.TransactionClient, private readonly runner?: TransactionRunner) {
    super(connection);
  }

  async transaction<T>(operation: (data: AuthWriteData) => Promise<T>): Promise<T> {
    const run: TransactionRunner = this.runner ?? (async (callback) => {
      const { prisma } = await import('../../lib/prisma.js');
      return prisma.$transaction(callback, { isolationLevel: 'ReadCommitted' });
    });
    try {
      return await run(async (tx) => {
        // Serialize staff writes and session issuance/revocation across processes.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(17291, 1)`;
        return operation(new PrismaAuthData(tx));
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'STAFF_EMAIL_EXISTS', 'Email is already in use');
      }
      throw error;
    }
  }
}
