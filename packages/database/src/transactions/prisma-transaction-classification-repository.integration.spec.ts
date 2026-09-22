import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  Category,
  CostCenter,
  Currency,
  FinancialAuditEvent,
  Money,
  Transaction,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import { PrismaCategoryRepository } from '../classifications/prisma-category-repository.js';
import { PrismaCostCenterRepository } from '../classifications/prisma-cost-center-repository.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionClassificationRepository } from './prisma-transaction-classification-repository.js';
import { PrismaTransactionRepository } from './prisma-transaction-repository.js';

describe('PrismaTransactionClassificationRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let setup:
    | (() => Promise<{
        category: Category;
        child: Category;
        costCenter: CostCenter;
        ownerId: string;
        transaction: Transaction;
      }>)
    | undefined;
  let repository: PrismaTransactionClassificationRepository | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migrationPaths = [
      '../../prisma/migrations/20260920040000_create_accounts/migration.sql',
      '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
      '../../prisma/migrations/20260920180000_create_categories/migration.sql',
      '../../prisma/migrations/20260920210000_create_cost_centers/migration.sql',
      '../../prisma/migrations/20260921010000_assign_transaction_classifications/migration.sql',
      '../../prisma/migrations/20260921110000_add_transaction_observations/migration.sql',
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
    ];
    const migrationClient = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migrationClient.connect();
    for (const path of migrationPaths) {
      await migrationClient.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    }
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaTransactionClassificationRepository(prisma);
    setup = async () => {
      const ownerId = 'b36bfe2a-f319-49a8-aade-2a536ea3af38';
      const currency = Currency.create('BRL', 2);
      const account = Account.create({
        color: null,
        createdAt: new Date('2026-09-21T12:00:00.000Z'),
        description: null,
        icon: null,
        id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
        initialBalance: Money.fromDecimal('0.00', currency),
        institution: null,
        name: 'Conta',
        ownerId,
        type: AccountType.create('checking-account'),
      });
      const transaction = Transaction.create({
        accountId: account.id,
        amount: Money.fromDecimal('10.00', currency),
        createdAt: new Date('2026-09-21T12:01:00.000Z'),
        description: null,
        id: 'f0ee8a15-69d3-45ca-a172-5f2512ed9fd1',
        kind: 'expense',
        occurredAt: new Date('2026-09-21T11:00:00.000Z'),
        ownerId,
      });
      const category = Category.create({
        createdAt: new Date('2026-09-21T12:02:00.000Z'),
        id: '79a44112-9757-4230-8065-0bfd0e078355',
        name: 'Moradia',
        ownerId,
        parentCategoryId: null,
      });
      const child = Category.create({
        createdAt: new Date('2026-09-21T12:03:00.000Z'),
        id: '2359023e-2ed7-45d0-a536-cb961abe3406',
        name: 'Aluguel',
        ownerId,
        parentCategoryId: category.id,
      });
      const costCenter = CostCenter.create({
        createdAt: new Date('2026-09-21T12:04:00.000Z'),
        id: 'c183a45f-379e-42ea-b94c-eb91b97e075c',
        name: 'Casa',
        ownerId,
      });
      await new PrismaAccountRepository(prisma).insert(
        account,
        accountAuditEvent(account),
      );
      await new PrismaTransactionRepository(prisma).insert(
        transaction,
        auditEvent(transaction),
      );
      await new PrismaCategoryRepository(prisma).insert(category);
      await new PrismaCategoryRepository(prisma).insert(child);
      await new PrismaCostCenterRepository(prisma).insert(costCenter);
      return { category, child, costCenter, ownerId, transaction };
    };
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('replaces an owned classification selection atomically', async () => {
    if (repository === undefined || setup === undefined) {
      throw new Error('Repository was not initialized.');
    }
    const { category, child, costCenter, ownerId, transaction } = await setup();
    const selection = {
      categoryId: category.id,
      costCenterId: costCenter.id,
      subcategoryId: child.id,
    };

    await expect(
      repository.replaceForOwner(transaction.id, ownerId, selection),
    ).resolves.toBe('updated');
    await expect(
      repository.getForOwner(transaction.id, ownerId),
    ).resolves.toEqual(selection);
  });
});

function auditEvent(transaction: Transaction): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: transaction.ownerId,
    id: crypto.randomUUID(),
    occurredAt: new Date('2026-09-21T12:01:00.000Z'),
    ownerId: transaction.ownerId,
    resourceId: transaction.id,
    resourceType: 'transaction',
  });
}

function accountAuditEvent(accountValue: Account): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: accountValue.ownerId,
    id: crypto.randomUUID(),
    occurredAt: new Date('2026-09-21T12:00:00.000Z'),
    ownerId: accountValue.ownerId,
    resourceId: accountValue.id,
    resourceType: 'account',
  });
}
