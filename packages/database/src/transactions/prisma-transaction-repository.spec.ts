import {
  Currency,
  FinancialAuditEvent,
  Money,
  Transaction,
} from '@seshat/domain';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaTransactionRepository } from './prisma-transaction-repository.js';

describe('PrismaTransactionRepository', () => {
  it('finds a transfer through either owned entry without exposing foreign links', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'transfer-id' });
    const client = {
      transfer: { findFirst },
    } as unknown as PrismaClient;
    const repository = new PrismaTransactionRepository(client);

    await expect(
      repository.findTransferIdByEntryForOwner('transaction-id', 'owner-id'),
    ).resolves.toBe('transfer-id');
    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        OR: [
          { sourceTransactionId: 'transaction-id' },
          { destinationTransactionId: 'transaction-id' },
        ],
        ownerId: 'owner-id',
      },
    });
  });

  it('queries an owned half-open instant range in deterministic order', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const client = {
      transaction: { findMany },
    } as unknown as PrismaClient;
    const repository = new PrismaTransactionRepository(client);
    const from = new Date('2026-09-20T00:00:00.000Z');
    const to = new Date('2026-09-21T00:00:00.000Z');

    await expect(
      repository.listForOwnerBetween('owner-id', from, to),
    ).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      include: { tagAssignments: { select: { tagId: true } } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      where: {
        occurredAt: { gte: from, lt: to },
        ownerId: 'owner-id',
      },
    });

    await repository.listForOwnerBetween('owner-id', from, to, 'active', {
      accountId: 'account-id',
      kind: 'expense',
      occurredAtOrder: 'desc',
    });
    expect(findMany).toHaveBeenLastCalledWith({
      include: { tagAssignments: { select: { tagId: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
      where: {
        accountId: 'account-id',
        kind: 'expense',
        lifecycle: 'active',
        occurredAt: { gte: from, lt: to },
        ownerId: 'owner-id',
      },
    });
  });

  it('does not write an edit or audit event when the expected version is stale', async () => {
    const updateMany = vi.fn();
    const createAuditEvent = vi.fn().mockResolvedValue({});
    const client = {
      $transaction: (operation: (transaction: unknown) => unknown) =>
        operation({
          $queryRaw: vi.fn().mockResolvedValue([]),
          financialAuditEvent: { create: createAuditEvent },
          transaction: {
            findFirst: vi.fn().mockResolvedValue(null),
            updateMany,
          },
        }),
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
    await expect(
      repository.save(transaction, 1, auditEvent(transaction)),
    ).resolves.toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });
});

function auditEvent(transaction: Transaction): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'updated',
    actorId: transaction.ownerId,
    id: '32c8ebf6-da8e-4b5f-993d-c5602f7afebd',
    occurredAt: new Date('2026-09-21T12:00:00.000Z'),
    ownerId: transaction.ownerId,
    resourceId: transaction.id,
    resourceType: 'transaction',
  });
}
