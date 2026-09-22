import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
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
import { PrismaTransactionRepository } from './prisma-transaction-repository.js';

describe('PrismaTransactionRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let accounts: PrismaAccountRepository | undefined;
  let prisma: PrismaClient | undefined;
  let transactions: PrismaTransactionRepository | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });
    await client.connect();
    for (const path of [
      '../../prisma/migrations/20260920040000_create_accounts/migration.sql',
      '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
      '../../prisma/migrations/20260920180000_create_categories/migration.sql',
      '../../prisma/migrations/20260920210000_create_cost_centers/migration.sql',
      '../../prisma/migrations/20260921010000_assign_transaction_classifications/migration.sql',
      '../../prisma/migrations/20260921110000_add_transaction_observations/migration.sql',
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
    ]) {
      await client.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    }
    await client.end();
    const connectedPrisma = createPrismaClient(container.getConnectionUri());
    prisma = connectedPrisma;
    disconnect = async (): Promise<void> => connectedPrisma.$disconnect();
    accounts = new PrismaAccountRepository(connectedPrisma);
    transactions = new PrismaTransactionRepository(connectedPrisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('round-trips exact amounts and isolates transaction ownership', async () => {
    if (
      accounts === undefined ||
      prisma === undefined ||
      transactions === undefined
    )
      throw new Error('Repositories unavailable.');
    const ownerId = 'b36bfe2a-f319-49a8-aade-2a536ea3af38';
    const account = Account.create({
      color: null,
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      description: null,
      icon: null,
      id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      initialBalance: Money.fromDecimal('0', Currency.create('BHD', 3)),
      institution: null,
      name: 'Synthetic account',
      ownerId,
      type: AccountType.create('checking-account'),
    });
    await accounts.insert(account);
    const transaction = Transaction.create({
      accountId: account.id,
      amount: Money.fromDecimal(
        '12345678901234567890.125',
        Currency.create('BHD', 3),
      ),
      createdAt: new Date('2026-09-20T13:00:00.000Z'),
      description: 'Synthetic transaction',
      id: '86684068-45d9-4e14-b454-f7e556b867e7',
      kind: 'income',
      occurredAt: new Date('2026-09-20T11:00:00.000Z'),
      ownerId,
    });

    await transactions.insert(
      transaction,
      auditEvent(
        transaction,
        'created',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    );

    expect(
      (
        await transactions.findByIdForOwner(transaction.id, ownerId)
      )?.toSnapshot(),
    ).toEqual(transaction.toSnapshot());
    await expect(
      transactions.listForAccountOwner(account.id, ownerId),
    ).resolves.toHaveLength(1);
    await expect(
      transactions.findByIdForOwner(
        transaction.id,
        'e89b6ad0-7838-4a2c-9a21-c775ea78e22a',
      ),
    ).resolves.toBeNull();
    await expect(
      transactions.listForOwnerBetween(
        ownerId,
        new Date('2026-09-20T10:00:00.000Z'),
        new Date('2026-09-20T12:00:00.000Z'),
      ),
    ).resolves.toHaveLength(1);
    await expect(
      transactions.listForOwnerBetween(
        ownerId,
        new Date('2026-09-20T10:00:00.000Z'),
        new Date('2026-09-20T11:00:00.000Z'),
      ),
    ).resolves.toEqual([]);

    transaction.updateDetails(
      {
        amount: Money.fromDecimal('42.375', Currency.create('BHD', 3)),
        description: 'Updated synthetic transaction',
        kind: 'expense',
        observations: 'Corrected after statement review',
        occurredAt: new Date('2026-09-21T10:30:00.000Z'),
      },
      new Date('2026-09-21T12:00:00.000Z'),
    );

    await expect(
      transactions.save(
        transaction,
        1,
        auditEvent(
          transaction,
          'updated',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ),
      ),
    ).resolves.toBe(true);
    const persisted = await transactions.findByIdForOwner(
      transaction.id,
      ownerId,
    );
    expect(persisted?.toSnapshot()).toEqual(transaction.toSnapshot());
    await expect(prisma.financialAuditEvent.count()).resolves.toBe(2);
    await expect(
      transactions.save(
        transaction,
        1,
        auditEvent(
          transaction,
          'updated',
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ),
      ),
    ).resolves.toBe(false);
    await expect(prisma.financialAuditEvent.count()).resolves.toBe(2);

    const rolledBack = Transaction.create({
      accountId: account.id,
      amount: Money.fromDecimal('1.000', Currency.create('BHD', 3)),
      createdAt: new Date('2026-09-21T13:00:00.000Z'),
      description: null,
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'expense',
      occurredAt: new Date('2026-09-21T13:00:00.000Z'),
      ownerId,
    });
    await expect(
      transactions.insert(
        rolledBack,
        auditEvent(
          rolledBack,
          'created',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ),
      ),
    ).rejects.toThrow();
    await expect(
      transactions.findByIdForOwner(rolledBack.id, ownerId),
    ).resolves.toBeNull();
  });
});

function auditEvent(
  transaction: Transaction,
  action: 'created' | 'updated',
  id: string,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId: transaction.ownerId,
    id,
    occurredAt: new Date('2026-09-21T13:00:00.000Z'),
    ownerId: transaction.ownerId,
    resourceId: transaction.id,
    resourceType: 'transaction',
  });
}
