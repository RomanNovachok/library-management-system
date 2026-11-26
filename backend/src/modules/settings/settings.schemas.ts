import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';

const settingName = z.string().transform((value) => value.trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(100).regex(/^[^\p{Cc}]+$/u));
const percent = z.string().regex(/^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/)
  .transform((value) => new Prisma.Decimal(value));
export const settingParams = z.strictObject({ id: z.uuid() });
export const emptySettingsQuery = z.strictObject({});
export const categoryCreate = z.strictObject({ name: settingName, discountPercent: percent });
export const categoryPatch = categoryCreate.partial().refine((input) => Object.keys(input).length > 0);
export const damageRulePatch = z.strictObject({ label: settingName, penaltyPercent: percent })
  .partial().refine((input) => Object.keys(input).length > 0);

export type CategoryCreate = z.output<typeof categoryCreate>;
export type CategoryPatch = z.output<typeof categoryPatch>;
export type DamageRulePatch = z.output<typeof damageRulePatch>;
