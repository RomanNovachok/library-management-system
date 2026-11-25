import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { StaffLocals } from '../../middleware/staff-auth.js';
import { newPassword, parseAuthInput, staffEmail } from '../auth/auth.schemas.js';
import type { StaffService } from './staff.service.js';

const role = z.enum(['ADMIN', 'LIBRARIAN']);
const createBody = z.strictObject({ email: staffEmail, role, password: newPassword });
const updateBody = z.strictObject({ email: staffEmail, role, isActive: z.boolean() }).partial()
  .refine((patch) => Object.keys(patch).length > 0);
const resetBody = z.strictObject({ password: newPassword });
const id = z.uuid();

export class StaffController {
  constructor(private readonly service: StaffService) {}

  list: RequestHandler = async (_req, res) => {
    res.json(await this.service.list());
  };

  create: RequestHandler = async (req, res) => {
    const { tokenHash }: StaffLocals = res.locals;
    const { email, role, password } = parseAuthInput(createBody, req.body);
    res.status(201).json(await this.service.create(tokenHash!, email, role, password));
  };

  update: RequestHandler = async (req, res) => {
    const { tokenHash }: StaffLocals = res.locals;
    const { email, role, isActive } = parseAuthInput(updateBody, req.body);
    const patch = {
      ...(email !== undefined && { email }),
      ...(role !== undefined && { role }),
      ...(isActive !== undefined && { isActive }),
    };
    res.json(await this.service.update(tokenHash!, parseAuthInput(id, req.params.id), patch));
  };

  resetPassword: RequestHandler = async (req, res) => {
    const { tokenHash }: StaffLocals = res.locals;
    const { password } = parseAuthInput(resetBody, req.body);
    await this.service.resetPassword(tokenHash!, parseAuthInput(id, req.params.id), password);
    res.sendStatus(204);
  };
}
