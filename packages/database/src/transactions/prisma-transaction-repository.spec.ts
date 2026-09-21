import { Currency, Money, Transaction } from '@seshat/domain';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaTransactionRepository } from './prisma-transaction-repository.js';

describe('PrismaTransactionRepository', () => {
  it('persists edited amount and kind with the optimistic version', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const client = {
      transaction: { updateMany },
    } as unknown as PrismaClient;
    const repository = new PrismaTransactionRepository(client);
    const transaction = Transaction.create({
      accountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      amount: Money.fromDecimal('100.000', Currency.create('BHD', 3)),
      createdAt: new Date('2026-09-20T13:00:00.000Z'),
      description: 'Original transaction',
      id: '86684068-45d9-4e14-b454-f7e556b867e7',
      kind: 'income',
      occurredAt: new Date('2026-09-20T11:00:00.000Z'),
      ownerId: 'b36bfe2a-f319-49a8-aade-2a536ea3af38',
    });
    transaction.updateDetails(
      {
        amount: Money.fromDecimal('42.375', Currency.create('BHD', 3)),
        description: 'Updated transaction',
        kind: 'expense',
        occurredAt: new Date('2026-09-21T10:30:00.000Z'),
      },
      new Date('2026-09-21T12:00:00.000Z'),
    );

    await expect(repository.save(transaction, 1)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        amountMinorUnits: '42375',
        archivedAt: null,
        description: 'Updated transaction',
        kind: 'expense',
        lifecycle: 'active',
        observations: null,
        occurredAt: new Date('2026-09-21T10:30:00.000Z'),
        trashedAt: null,
        updatedAt: new Date('2026-09-21T12:00:00.000Z'),
        version: 2,
      },
      where: {
        id: '86684068-45d9-4e14-b454-f7e556b867e7',
        ownerId: 'b36bfe2a-f319-49a8-aade-2a536ea3af38',
        version: 1,
      },
    });
  });
});
