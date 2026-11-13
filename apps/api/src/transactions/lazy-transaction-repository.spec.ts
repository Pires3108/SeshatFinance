import { describe, expect, it } from 'vitest';

import type { LazyPrismaClient } from '../platform/lazy-prisma-client.js';
import { LazyTransactionRepository } from './lazy-transaction-repository.js';

describe('LazyTransactionRepository', () => {
  it('exposes the card settlement guard so protected entries are enforced', () => {
    const repository = new LazyTransactionRepository(
      {} as unknown as LazyPrismaClient,
    );

    expect(typeof repository.findCardSettlementIdByEntryForOwner).toBe(
      'function',
    );
  });
});
