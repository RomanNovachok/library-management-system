import type { CopyCondition, DamageOutcome, Prisma, RentalStatus } from '../../generated/prisma/client.js';

interface RentalEventData {
  rentalId: string;
  actorId: string;
  occurredAt: Date;
}

export interface RentalIssued extends RentalEventData {
  type: 'RENTAL_ISSUED';
}

export interface RentalClosed extends RentalEventData {
  type: 'RENTAL_CLOSED';
  status: Exclude<RentalStatus, 'ACTIVE'>;
  copyStatus: DamageOutcome;
  damageRuleId: string;
  conditionAtIssue: CopyCondition | null;
  condition: CopyCondition;
  ruleCode: 'NONE' | 'MINOR' | 'MAJOR' | 'LOST';
  damagePercent: string;
}

export type RentalEvent = RentalIssued | RentalClosed;

export interface RentalEventSubscriber {
  onRentalEvent(event: RentalEvent): Promise<void>;
}

export class RentalEventPublisher {
  private readonly subscribers = new Set<RentalEventSubscriber>();

  subscribe(subscriber: RentalEventSubscriber) {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async publish(event: RentalEvent) {
    const results = await Promise.allSettled([...this.subscribers].map(async (subscriber) => subscriber.onRentalEvent(event)));
    for (const result of results) {
      if (result.status === 'rejected') console.error('Rental event subscriber failed', event.type, event.rentalId);
    }
  }
}

export class AuditLogSubscriber implements RentalEventSubscriber {
  constructor(private readonly database?: Pick<Prisma.TransactionClient, 'auditLog'>) {}

  async onRentalEvent(event: RentalEvent) {
    const db = this.database ?? (await import('../../lib/prisma.js')).prisma;
    await db.auditLog.create({ data: {
      actorId: event.actorId,
      action: event.type,
      entityType: 'Rental',
      entityId: event.rentalId,
      createdAt: event.occurredAt,
      ...(event.type === 'RENTAL_CLOSED' && { details: {
        status: event.status, copyStatus: event.copyStatus, damageRuleId: event.damageRuleId,
        conditionAtIssue: event.conditionAtIssue, conditionAtReturn: event.condition,
        ruleCode: event.ruleCode, damagePercent: event.damagePercent,
      } }),
    } });
  }
}
