import {
  FinancialAuditEvent,
  type FinancialAuditAction,
  type FinancialAuditResourceType,
} from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export type CreateFinancialAuditEventCommand = Readonly<{
  action: FinancialAuditAction;
  actorId: string;
  ownerId: string;
  resourceId: string;
  resourceType: FinancialAuditResourceType;
}>;

export class FinancialAuditEventFactory {
  public constructor(
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public create(
    command: CreateFinancialAuditEventCommand,
  ): FinancialAuditEvent {
    return FinancialAuditEvent.create({
      ...command,
      id: this.identifiers.generate(),
      occurredAt: this.clock.now(),
    });
  }
}
