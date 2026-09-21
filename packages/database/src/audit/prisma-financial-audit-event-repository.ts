import type { FinancialAuditEvent } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';
import type {
  FinancialAuditAction,
  FinancialAuditResourceType,
} from '../generated/prisma/enums.js';

export class PrismaFinancialAuditEventRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(event: FinancialAuditEvent): Promise<void> {
    const snapshot = event.toSnapshot();
    await this.client.financialAuditEvent.create({
      data: {
        action: toPersistedAction(snapshot.action),
        actorId: snapshot.actorId,
        id: snapshot.id,
        occurredAt: snapshot.occurredAt,
        ownerId: snapshot.ownerId,
        resourceId: snapshot.resourceId,
        resourceType: toPersistedResourceType(snapshot.resourceType),
      },
    });
  }
}

function toPersistedAction(
  action: ReturnType<FinancialAuditEvent['toSnapshot']>['action'],
): FinancialAuditAction {
  switch (action) {
    case 'moved-to-trash':
      return 'moved_to_trash';
    case 'restored-from-trash':
      return 'restored_from_trash';
    default:
      return action;
  }
}

function toPersistedResourceType(
  resourceType: ReturnType<FinancialAuditEvent['toSnapshot']>['resourceType'],
): FinancialAuditResourceType {
  return resourceType === 'balance-adjustment'
    ? 'balance_adjustment'
    : resourceType;
}
