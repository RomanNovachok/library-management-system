import type { CookieOptions, RequestHandler } from 'express';
import { readSessionHash, type StaffLocals } from '../../middleware/staff-auth.js';
import { changePasswordBody, loginBody, parseAuthInput } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly cookieName: string,
    private readonly cookie: CookieOptions,
    private readonly sessionTtlMs: number,
  ) {}

  login: RequestHandler = async (req, res) => {
    const { email, password } = parseAuthInput(loginBody, req.body);
    const { user, token } = await this.service.login(email, password, req.socket.remoteAddress ?? 'unknown', readSessionHash(req, this.cookieName));
    res.cookie(this.cookieName, token, { ...this.cookie, maxAge: this.sessionTtlMs }).status(200).json(user);
  };

  logout: RequestHandler = async (req, res) => {
    await this.service.logout(readSessionHash(req, this.cookieName));
    res.clearCookie(this.cookieName, this.cookie).sendStatus(204);
  };

  me: RequestHandler = (_req, res) => {
    const { staff }: StaffLocals = res.locals;
    res.json(staff);
  };

  changePassword: RequestHandler = async (req, res) => {
    const { staff, tokenHash }: StaffLocals = res.locals;
    const { oldPassword, newPassword } = parseAuthInput(changePasswordBody, req.body);
    await this.service.changePassword(staff!.id, tokenHash!, oldPassword, newPassword);
    res.clearCookie(this.cookieName, this.cookie).sendStatus(204);
  };
}
