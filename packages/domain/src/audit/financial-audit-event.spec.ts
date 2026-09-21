import { describe, expect, it } from 'vitest';

import {
  FinancialAuditEvent,
  InvalidFinancialAuditEventError,
} from './financial-audit-event.js';

describe('FinancialAuditEvent', () => {
  it('captures immutable audit metadata without financial values', () => {
    const occurredAt = new Date('2026-09-21T18:00:00.000Z');
    const event = FinancialAuditEvent.create({
      action: 'created',
      actorId: 'actor-id',
      id: 'event-id',
      occurredAt,
      ownerId: 'owner-id',
      resourceId: 'transaction-id',
      resourceType: 'transaction',
    });

    occurredAt.setUTCFullYear(2000);

    expect(event.toSnapshot()).toEqual({
      action: 'created',
      actorId: 'actor-id',
      id: 'event-id',
      occurredAt: new Date('2026-09-21T18:00:00.000Z'),
      ownerId: 'owner-id',
      resourceId: 'transaction-id',
      resourceType: 'transaction',
    });
  });

  it('rejects incomplete identity or an invalid instant', () => {
    expect(() =>
      FinancialAuditEvent.create({
        action: 'updated',
        actorId: ' ',
        id: 'event-id',
        occurredAt: new Date('invalid'),
        ownerId: 'owner-id',
        resourceId: 'transaction-id',
        resourceType: 'transaction',
      }),
    ).toThrow(InvalidFinancialAuditEventError);
  });
});
