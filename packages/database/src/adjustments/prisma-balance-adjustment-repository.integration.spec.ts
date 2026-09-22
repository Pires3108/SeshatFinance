import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  BalanceAdjustment,
  Currency,
  FinancialAuditEvent,
  Money,
  Transaction,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';
import { PrismaBalanceAdjustmentRepository } from './prisma-balance-adjustment-repository.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const accountId = '11111111-1111-4111-8111-111111111111';
const currency = Currency.create('BRL', 2);

describe('PrismaBalanceAdjustmentRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let repository: PrismaBalanceAdjustmentRepository | undefined;

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
      '../../prisma/migrations/20260920180000_create_categories/migration.sql',
      '../../prisma/migrations/20260920190000_create_tags/migration.sql',
      '../../prisma/migrations/20260920200000_assign_transaction_tags/migration.sql',
      '../../prisma/migrations/20260920210000_create_cost_centers/migration.sql',
      '../../prisma/migrations/20260921010000_assign_transaction_classifications/migration.sql',
      '../../prisma/migrations/20260921110000_add_transaction_observations/migration.sql',
      '../../prisma/migrations/20260921150000_create_transfers/migration.sql',
      '../../prisma/migrations/20260921170000_create_balance_adjustments/migration.sql',
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
    ]) {
      await migrationClient.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    }
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    client = prisma;
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaBalanceAdjustmentRepository(prisma);
    await new PrismaAccountRepository(prisma).insert(account());
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('inserts the entry and audit metadata in one transaction', async () => {
    if (client === undefined || repository === undefined) throw unavailable();

    const created = adjustment('100.00', '125.50');
    await expect(
      repository.insertAtomically(
        created,
        adjustmentAuditEvent(created, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      ),
    ).resolves.toBe(true);
    await expect(client.transaction.count()).resolves.toBe(1);
    await expect(client.financialAuditEvent.count()).resolves.toBe(1);
    const row = await client.balanceAdjustment.findFirstOrThrow();
    expect(row.justification).toBe('Synthetic reconciliation');
    expect(row.previousBalanceMinorUnits.toFixed(0)).toBe('10000');
    expect(row.reportedBalanceMinorUnits.toFixed(0)).toBe('12550');
    expect(row.differenceMinorUnits.toFixed(0)).toBe('2550');
  });

  it('rejects a stale previous balance without partial writes', async () => {
    if (client === undefined || repository === undefined) throw unavailable();
    const income = existingIncome();
    await new PrismaTransactionRepository(client).insert(
      income,
      auditEvent(income),
    );
    const beforeTransactions = await client.transaction.count();
    const beforeAdjustments = await client.balanceAdjustment.count();
    const beforeAuditEvents = await client.financialAuditEvent.count();

    const stale = adjustment('125.50', '130.00');
    await expect(
      repository.insertAtomically(
        stale,
        adjustmentAuditEvent(stale, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      ),
    ).resolves.toBe(false);
    await expect(client.transaction.count()).resolves.toBe(beforeTransactions);
    await expect(client.balanceAdjustment.count()).resolves.toBe(
      beforeAdjustments,
    );
    await expect(client.financialAuditEvent.count()).resolves.toBe(
      beforeAuditEvents,
    );

    const auditFailure = adjustment('130.50', '140.00');
    await expect(
      repository.insertAtomically(
        auditFailure,
        adjustmentAuditEvent(
          auditFailure,
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ),
      ),
    ).rejects.toThrow();
    await expect(client.transaction.count()).resolves.toBe(beforeTransactions);
    await expect(client.balanceAdjustment.count()).resolves.toBe(
      beforeAdjustments,
    );
  });
});

function account(): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-21T10:00:00.000Z'),
    description: null,
    icon: null,
    id: accountId,
    initialBalance: Money.fromDecimal('100.00', currency),
    institution: null,
    name: 'Synthetic account',
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

function adjustment(previous: string, reported: string): BalanceAdjustment {
  return BalanceAdjustment.create({
    accountId,
    createdAt: new Date('2026-09-21T12:00:00.000Z'),
    id: crypto.randomUUID(),
    justification: 'Synthetic reconciliation',
    occurredAt: new Date('2026-09-21T11:00:00.000Z'),
    ownerId,
    previousBalance: Money.fromDecimal(previous, currency),
    reportedBalance: Money.fromDecimal(reported, currency),
    transactionId: crypto.randomUUID(),
  });
}

function existingIncome(): Transaction {
  return Transaction.create({
    accountId,
    amount: Money.fromDecimal('5.00', currency),
    createdAt: new Date('2026-09-21T12:30:00.000Z'),
    description: null,
    id: crypto.randomUUID(),
    kind: 'income',
    occurredAt: new Date('2026-09-21T12:30:00.000Z'),
    ownerId,
  });
}

function auditEvent(transaction: Transaction): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: transaction.ownerId,
    id: crypto.randomUUID(),
    occurredAt: new Date('2026-09-21T12:30:00.000Z'),
    ownerId: transaction.ownerId,
    resourceId: transaction.id,
    resourceType: 'transaction',
  });
}

function adjustmentAuditEvent(
  adjustmentValue: BalanceAdjustment,
  id: string,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: adjustmentValue.ownerId,
    id,
    occurredAt: new Date('2026-09-21T12:00:00.000Z'),
    ownerId: adjustmentValue.ownerId,
    resourceId: adjustmentValue.id,
    resourceType: 'balance-adjustment',
  });
}

function unavailable(): Error {
  return new Error('Balance adjustment persistence is unavailable.');
}
