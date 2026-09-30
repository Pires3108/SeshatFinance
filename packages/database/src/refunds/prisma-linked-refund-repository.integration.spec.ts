import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { LinkedRefundConflictError } from '@seshat/application';
import type { LinkedRefundRecord } from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Currency,
  FinancialAuditEvent,
  Money,
  Transaction,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';
import { PrismaLinkedRefundRepository } from './prisma-linked-refund-repository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const foreignOwnerId = '22222222-2222-4222-8222-222222222222';
const expenseAccountId = '33333333-3333-4333-8333-333333333333';
const incomingAccountId = '44444444-4444-4444-8444-444444444444';
const expenseId = '55555555-5555-4555-8555-555555555555';
const currency = Currency.create('BRL', 2);
const at = new Date('2026-09-29T12:00:00.000Z');

describe('PrismaLinkedRefundRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let prisma: PrismaClient;
  let refunds: PrismaLinkedRefundRepository;
  let transactions: PrismaTransactionRepository;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migrationClient = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migrationClient.connect();
    for (const path of [
      '../../prisma/migrations/20260920040000_create_accounts/migration.sql',
      '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
      '../../prisma/migrations/20260920190000_create_tags/migration.sql',
      '../../prisma/migrations/20260920200000_assign_transaction_tags/migration.sql',
      '../../prisma/migrations/20260921110000_add_transaction_observations/migration.sql',
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
      '../../prisma/migrations/20260929170000_create_refund_links/migration.sql',
    ]) {
      await migrationClient.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    }
    await migrationClient.end();
    prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => prisma.$disconnect();
    refunds = new PrismaLinkedRefundRepository(prisma);
    transactions = new PrismaTransactionRepository(prisma);
    for (const id of [expenseAccountId, incomingAccountId]) {
      await prisma.account.create({
        data: {
          id,
          ownerId,
          name: 'Synthetic account',
          typeKey: 'checking-account',
          initialBalanceMinorUnits: '0',
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          createdAt: at,
          updatedAt: at,
        },
      });
    }
    await prisma.transaction.create({
      data: {
        id: expenseId,
        ownerId,
        accountId: expenseAccountId,
        kind: 'expense',
        amountMinorUnits: '10000',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        occurredAt: at,
        createdAt: at,
        updatedAt: at,
      },
    });
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('records a linked income atomically and replays the same request once', async () => {
    const key = randomUUID();
    const record = makeRecord('refund', '40.00');
    const created = await refunds.record(record, key, audit(record));
    const replay = await refunds.record(
      makeRecord('refund', '40.00'),
      key,
      audit(record),
    );
    expect(replay.id).toBe(created.id);
    expect(replay.entry.id).toBe(created.entry.id);
    expect(
      (
        await refunds.getForExpense(expenseId, ownerId)
      )?.summary.net.toDecimal(),
    ).toBe('60.00');
    expect(await prisma.refundLink.count({ where: { ownerId } })).toBe(1);
    expect(
      await prisma.financialAuditEvent.count({
        where: { resourceId: created.entry.id },
      }),
    ).toBe(1);
    await expect(
      refunds.record(makeRecord('refund', '41.00'), key, audit(record)),
    ).rejects.toThrow(LinkedRefundConflictError);
    await expect(
      refunds.getForExpense(expenseId, foreignOwnerId),
    ).resolves.toBeNull();
  });

  it('serializes competing refunds and rejects an over-refund', async () => {
    const first = makeRecord('refund', '50.00');
    const second = makeRecord('refund', '50.00');
    const results = await Promise.allSettled([
      refunds.record(first, randomUUID(), audit(first)),
      refunds.record(second, randomUUID(), audit(second)),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      (
        await refunds.getForExpense(expenseId, ownerId)
      )?.summary.refunded.toDecimal(),
    ).toBe('90.00');
    expect(await prisma.refundLink.count({ where: { ownerId } })).toBe(2);
  });

  it('compensates without editing history and protects lifecycle invariants', async () => {
    const details = await refunds.getForExpense(expenseId, ownerId);
    const original = details?.entries[0];
    if (original === undefined) throw new Error('Original refund missing.');
    const compensation = makeRecord('compensation', '20.00', original.id);
    await refunds.record(compensation, randomUUID(), audit(compensation));
    expect(
      (
        await refunds.getForExpense(expenseId, ownerId)
      )?.summary.refunded.toDecimal(),
    ).toBe('70.00');
    const additional = makeRecord('refund', '30.00');
    await refunds.record(additional, randomUUID(), audit(additional));
    expect(
      (
        await refunds.getForExpense(expenseId, ownerId)
      )?.summary.refunded.toDecimal(),
    ).toBe('100.00');
    const stored = await transactions.findByIdForOwner(
      compensation.entry.id,
      ownerId,
    );
    if (stored === null) throw new Error('Compensation entry missing.');
    stored.moveToTrash(new Date('2026-09-29T13:00:00.000Z'));
    await expect(
      transactions.save(stored, 1, audit(compensation)),
    ).rejects.toThrow(LinkedRefundConflictError);
    expect(
      (
        await refunds.getForExpense(expenseId, ownerId)
      )?.summary.refunded.toDecimal(),
    ).toBe('100.00');
    const originalEntry = await transactions.findByIdForOwner(
      original.entry.id,
      ownerId,
    );
    if (originalEntry === null) throw new Error('Refund entry missing.');
    originalEntry.updateDetails(
      {
        amount: Money.fromDecimal('39.00', currency),
        description: null,
        kind: 'income',
        occurredAt: at,
      },
      new Date('2026-09-29T13:00:00.000Z'),
    );
    await expect(
      transactions.save(originalEntry, 1, audit(compensation)),
    ).rejects.toThrow(LinkedRefundConflictError);
  });
});

function makeRecord(
  kind: 'refund' | 'compensation',
  amount: string,
  compensatesRefundId: string | null = null,
): LinkedRefundRecord {
  const entry = Transaction.create({
    accountId: incomingAccountId,
    amount: Money.fromDecimal(amount, currency),
    createdAt: at,
    description: null,
    id: randomUUID(),
    kind: kind === 'refund' ? 'income' : 'expense',
    occurredAt: at,
    ownerId,
  });
  return {
    id: randomUUID(),
    expenseTransactionId: expenseId,
    entry,
    kind,
    compensatesRefundId,
    reason: kind === 'compensation' ? 'Synthetic correction' : null,
    createdAt: at,
  } as const;
}

function audit(record: ReturnType<typeof makeRecord>): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: ownerId,
    id: randomUUID(),
    occurredAt: at,
    ownerId,
    resourceId: record.entry.id,
    resourceType: 'transaction',
  });
}
