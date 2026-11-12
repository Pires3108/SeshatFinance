import { describe, expect, it } from 'vitest';

import {
  FINANCIAL_AUDIT_TRAIL_MAX_PAGE,
  ListOwnedFinancialAuditTrailUseCase,
  VerifyOwnedFinancialAuditChainUseCase,
  type FinancialAuditTrailQuery,
  type FinancialAuditTrailRepository,
} from './financial-audit-trail.js';

function recordingTrail(): FinancialAuditTrailRepository & {
  calls: { ownerId: string; query?: FinancialAuditTrailQuery }[];
} {
  const calls: { ownerId: string; query?: FinancialAuditTrailQuery }[] = [];
  return {
    calls,
    listForOwner: (ownerId, query) => {
      calls.push({ ownerId, query });
      return Promise.resolve([]);
    },
    verifyChainForOwner: (ownerId) => {
      calls.push({ ownerId });
      return Promise.resolve({ checkedEvents: 3n, firstInvalidSequence: null });
    },
  };
}

describe('financial audit trail use cases (US-035)', () => {
  it.each([
    [0, 1],
    [25, 25],
    [10_000, FINANCIAL_AUDIT_TRAIL_MAX_PAGE],
  ])(
    'clamps a page size of %i to %i for the actor only',
    async (limit, expected) => {
      const trail = recordingTrail();
      await new ListOwnedFinancialAuditTrailUseCase(trail).execute('actor-id', {
        afterSequence: 7n,
        limit,
        resourceType: 'transfer',
      });
      expect(trail.calls).toEqual([
        {
          ownerId: 'actor-id',
          query: {
            afterSequence: 7n,
            limit: expected,
            resourceType: 'transfer',
          },
        },
      ]);
    },
  );

  it('verifies only the actor chain', async () => {
    const trail = recordingTrail();
    await expect(
      new VerifyOwnedFinancialAuditChainUseCase(trail).execute('actor-id'),
    ).resolves.toEqual({ checkedEvents: 3n, firstInvalidSequence: null });
    expect(trail.calls).toEqual([{ ownerId: 'actor-id' }]);
  });
});
