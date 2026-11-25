import { isConditionNotes, isCopyCondition } from './book-contract';
import type { ConditionData, CopyCondition, CopyInspection, CopyStatus } from './book-contract';
import { isPage, record, uuid } from './reader-contract';

export const rentalStatuses = ['ACTIVE', 'RETURNED', 'LOST'] as const;
export type RentalStatus = typeof rentalStatuses[number];
export type ReturnCopyStatus = Exclude<CopyStatus, 'RENTED'>;
export interface RentalSummary {
  id: string;
  status: RentalStatus;
  overdue: boolean;
  issuedAt: string;
  dueAt: string;
  closedAt: string | null;
  reader: { id: string; fullName: string };
  copy: ConditionData & { id: string; inventoryCode: string; status: CopyStatus; book: { id: string; title: string; author: string } };
}
interface Staff { id: string; email: string; role: 'ADMIN' | 'LIBRARIAN' }
interface RuleLabel { id: string; code: string; label: string }
export interface DamageRule extends RuleLabel { penaltyPercent: string; outcome: ReturnCopyStatus }
export interface CashMovement { id: string; type: 'DEPOSIT_IN' | 'REFUND_OUT' | 'TOPUP_IN'; amount: string; createdAt: string; recordedBy: Staff }
export interface RentalDetails extends RentalSummary {
  issuedBy: Staff;
  closedBy: Staff | null;
  pricePerDaySnapshot: string;
  depositSnapshot: string;
  discountPercentSnapshot: string;
  readerCategorySnapshot: string;
  billableDays: number | null;
  rentalFee: string | null;
  damageFine: string | null;
  damagePercentSnapshot: string | null;
  damageRuleId: string | null;
  damageRule: RuleLabel | null;
  refundAmount: string | null;
  additionalPayment: string | null;
  cashMovements: CashMovement[];
  conditionAtIssue: CopyCondition | null;
  conditionNotesAtIssue: string | null;
  conditionAtReturn: CopyCondition | null;
  conditionNotesAtReturn: string | null;
  newDamageNotes: string | null;
}
export interface IssueRentalInput { readerId: string; copyId: string; dueAt: string; inspection?: CopyInspection }
type Assessment =
  | { type: 'UNCHANGED'; inspection?: CopyInspection }
  | { type: 'DAMAGED'; severity: 'MINOR' | 'MAJOR'; condition: 'MINOR_DAMAGE' | 'MAJOR_DAMAGE'; newDamageNotes: string; existingDamageNotes?: string }
  | { type: 'LOST' };
export interface ReturnInput { assessment: Assessment; copyStatus?: Exclude<ReturnCopyStatus, 'LOST'> }
export interface ReturnPreview extends ConditionData {
  rentalId: string;
  damageRuleId: string;
  copyStatus: ReturnCopyStatus;
  status: 'RETURNED' | 'LOST';
  newDamageNotes: string | null;
  billableDays: number;
  damagePercent: string;
  deposit: string;
  rentalFee: string;
  damageFine: string;
  charges: string;
  refundAmount: string;
  additionalPayment: string;
  previewVersion: string;
}

const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const money = (value: unknown) => typeof value === 'string' && /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value);
const percent = (value: unknown) => typeof value === 'string' && /^(?:(?:0|[1-9]\d?)\.\d{2}|100\.00)$/.test(value);
const days = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
export const isRentalStatus = (value: unknown): value is RentalStatus => typeof value === 'string' && rentalStatuses.some((status) => status === value);
const isReturnCopyStatus = (value: unknown) => value === 'AVAILABLE' || value === 'MAINTENANCE' || value === 'LOST';

function summary(value: unknown): value is RentalSummary {
  return record(value) && uuid(value.id) && isRentalStatus(value.status) && typeof value.overdue === 'boolean'
    && date(value.issuedAt) && date(value.dueAt) && (value.status === 'ACTIVE' ? value.closedAt === null : date(value.closedAt))
    && record(value.reader) && uuid(value.reader.id) && text(value.reader.fullName)
    && record(value.copy) && uuid(value.copy.id) && text(value.copy.inventoryCode)
    && (value.copy.status === 'RENTED' || isReturnCopyStatus(value.copy.status))
    && isCopyCondition(value.copy.condition) && isConditionNotes(value.copy.conditionNotes)
    && record(value.copy.book) && uuid(value.copy.book.id) && text(value.copy.book.title) && text(value.copy.book.author);
}
function staff(value: unknown): value is Staff {
  return record(value) && uuid(value.id) && text(value.email) && (value.role === 'ADMIN' || value.role === 'LIBRARIAN');
}
function ruleLabel(value: unknown): value is RuleLabel {
  return record(value) && uuid(value.id) && text(value.code) && text(value.label);
}
function rule(value: unknown): value is DamageRule {
  return ruleLabel(value) && record(value) && percent(value.penaltyPercent) && isReturnCopyStatus(value.outcome);
}
function movement(value: unknown): value is CashMovement {
  return record(value) && uuid(value.id) && ['DEPOSIT_IN', 'REFUND_OUT', 'TOPUP_IN'].some((type) => value.type === type)
    && money(value.amount) && date(value.createdAt) && staff(value.recordedBy);
}
function details(value: unknown): value is RentalDetails {
  if (!record(value) || !summary(value) || !staff(value.issuedBy) || !money(value.pricePerDaySnapshot)
    || !money(value.depositSnapshot) || !percent(value.discountPercentSnapshot) || !text(value.readerCategorySnapshot)
    || !Array.isArray(value.cashMovements) || !value.cashMovements.every(movement)
    || ![value.conditionAtIssue, value.conditionAtReturn].every((condition) => condition === null || isCopyCondition(condition))
    || ![value.conditionNotesAtIssue, value.conditionNotesAtReturn, value.newDamageNotes].every(isConditionNotes)) return false;
  const amounts = [value.rentalFee, value.damageFine, value.refundAmount, value.additionalPayment];
  if (value.status === 'ACTIVE') {
    return value.closedBy === null && value.billableDays === null && value.damagePercentSnapshot === null
      && value.damageRuleId === null && value.damageRule === null && amounts.every((amount) => amount === null);
  }
  return staff(value.closedBy) && days(value.billableDays) && percent(value.damagePercentSnapshot) && amounts.every(money)
    && (value.damageRuleId === null ? value.damageRule === null : ruleLabel(value.damageRule) && value.damageRule.id === value.damageRuleId);
}
function preview(value: unknown): value is ReturnPreview {
  return record(value) && uuid(value.rentalId) && uuid(value.damageRuleId) && isReturnCopyStatus(value.copyStatus)
    && isCopyCondition(value.condition) && isConditionNotes(value.conditionNotes) && isConditionNotes(value.newDamageNotes)
    && value.status === (value.copyStatus === 'LOST' ? 'LOST' : 'RETURNED') && days(value.billableDays) && percent(value.damagePercent)
    && [value.deposit, value.rentalFee, value.damageFine, value.refundAmount, value.additionalPayment].every(money)
    && typeof value.charges === 'string' && /^(0|[1-9]\d{0,10})\.\d{2}$/.test(value.charges)
    && typeof value.previewVersion === 'string' && /^[a-f0-9]{64}$/.test(value.previewVersion);
}
export const isRentalsResponse = (value: unknown) => isPage(value, summary);
export const isRentalResponse = (value: unknown): value is { data: RentalDetails } => record(value) && details(value.data);
export const isDamageRulesResponse = (value: unknown): value is { data: DamageRule[] } => record(value) && Array.isArray(value.data) && value.data.every(rule);
export const isReturnPreviewResponse = (value: unknown): value is { data: ReturnPreview } => record(value) && preview(value.data);
