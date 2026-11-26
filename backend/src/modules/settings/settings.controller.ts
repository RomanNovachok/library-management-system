import type { RequestHandler } from 'express';
import type { StaffLocals } from '../../middleware/staff-auth.js';
import { categoryCreate, categoryPatch, damageRulePatch, emptySettingsQuery, settingParams } from './settings.schemas.js';
import type { SettingsService } from './settings.service.js';

export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  readerCategories: RequestHandler = async (req, res) => {
    emptySettingsQuery.parse(req.query);
    res.json({ data: await this.service.readerCategories() });
  };

  createCategory: RequestHandler = async (req, res) => {
    emptySettingsQuery.parse(req.query);
    const { tokenHash }: StaffLocals = res.locals;
    const data = await this.service.createCategory(tokenHash!, categoryCreate.parse(req.body));
    res.status(201).json({ data });
  };

  updateCategory: RequestHandler = async (req, res) => {
    emptySettingsQuery.parse(req.query);
    const { id } = settingParams.parse(req.params);
    const { tokenHash }: StaffLocals = res.locals;
    res.json({ data: await this.service.updateCategory(tokenHash!, id, categoryPatch.parse(req.body)) });
  };

  damageRules: RequestHandler = async (req, res) => {
    emptySettingsQuery.parse(req.query);
    res.json({ data: await this.service.damageRules() });
  };

  updateDamageRule: RequestHandler = async (req, res) => {
    emptySettingsQuery.parse(req.query);
    const { id } = settingParams.parse(req.params);
    const { tokenHash }: StaffLocals = res.locals;
    res.json({ data: await this.service.updateDamageRule(tokenHash!, id, damageRulePatch.parse(req.body)) });
  };
}
