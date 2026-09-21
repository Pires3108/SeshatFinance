import { describe, expect, it } from 'vitest';

import { FinancialAuditEventFactory } from './create-financial-audit-event.js';

describe('FinancialAuditEventFactory', () => {
  it('injects the identifier and authoritative instant', () => {
    const factory = new FinancialAuditEventFactory(
      { now: () => new Date('2026-09-21T18:00:00.000Z') },
      { generate: () => 'audit-event-id' },
    );

    expect(
      factory
        .create({
          action: 'created',
          actorId: 'actor-id',
          ownerId: 'owner-id',
          resourceId: 'transfer-id',
          resourceType: 'transfer',
        })
        .toSnapshot(),
    ).toEqual({
      action: 'created',
      actorId: 'actor-id',
      id: 'audit-event-id',
      occurredAt: new Date('2026-09-21T18:00:00.000Z'),
      ownerId: 'owner-id',
      resourceId: 'transfer-id',
      resourceType: 'transfer',
    });
  });
});
