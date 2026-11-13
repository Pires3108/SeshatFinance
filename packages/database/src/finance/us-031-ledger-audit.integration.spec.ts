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
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';

const ownerId = '31111111-1111-4111-8111-111111111111';
const otherOwnerId = '39999999-9999-4999-8999-999999999999';
const accountId = '32222222-2222-4222-8222-222222222222';
const otherAccountId = '33333333-3333-4333-8333-333333333333';
const currency = Currency.create('BRL', 2);
const occurredAt = new Date('2026-09-20T11:00:00.000Z');

describe('US-031 initial ledger and audit proof', () => {
  let prisma: PrismaClient;
  let repository: PrismaTransactionRepository;
  let stop: () => Promise<void>;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => {
      await container.stop();
    };
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });
    await client.connect();
    try {
      for (const path of [
        '../../prisma/migrations/20260920040000_create_accounts/migration.sql',
        '../../prisma/migrations/20261015120000_add_account_agency/migration.sql',
        '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
        '../../prisma/migrations/20260920180000_create_categories/migration.sql',
        '../../prisma/migrations/20260920190000_create_tags/migration.sql',
        '../../prisma/migrations/20260920200000_assign_transaction_tags/migration.sql',
        '../../prisma/migrations/20260920210000_create_cost_centers/migration.sql',
        '../../prisma/migrations/20260921010000_assign_transaction_classifications/migration.sql',
        '../../prisma/migrations/20260921110000_add_transaction_observations/migration.sql',
        '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
        '../../prisma/migrations/20261112120000_financial_audit_hash_chain/migration.sql',
        '../../prisma/migrations/20261005180000_create_counterparties/migration.sql',
        '../../prisma/migrations/20261021180000_counterparty_lifecycle_and_transaction_reference/migration.sql',
        '../../prisma/migrations/20261020120000_category_catalog_lifecycle/migration.sql',
        '../../prisma/migrations/20261020130000_tag_lifecycle/migration.sql',
        '../../prisma/migrations/20261021120000_cost_center_lifecycle/migration.sql',
        '../../prisma/migrations/20261103010000_transaction_idempotency/migration.sql',
        '../../prisma/migrations/20260919210000_create_user_profiles/migration.sql',
        '../../prisma/migrations/20261109120000_transaction_time_zone/migration.sql',
        '../../prisma/migrations/20261112130000_trash_elimination/migration.sql',
      ])
        await client.query(
          await readFile(new URL(path, import.meta.url), 'utf8'),
        );
    } finally {
      await client.end();
    }
    prisma = createPrismaClient(container.getConnectionUri());
    repository = new PrismaTransactionRepository(prisma);
    const accounts = new PrismaAccountRepository(prisma);
    for (const [id, owner] of [
      [accountId, ownerId],
      [otherAccountId, otherOwnerId],
    ] as const) {
      await accounts.insert(
        Account.create({
          color: null,
          createdAt: occurredAt,
          description: null,
          icon: null,
          id,
          initialBalance: Money.fromDecimal('100.00', currency),
          institution: null,
          name: 'Synthetic account',
          ownerId: owner,
          type: AccountType.create('checking-account'),
        }),
        audit(id, owner, 'account'),
      );
    }
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await prisma.$disconnect();
    await stop();
  });

  it('nets exact income and expense effects and isolates owner, account, kind and half-open time filters', async () => {
    const incomeId = '34444444-4444-4444-8444-444444444444';
    const expenseId = '35555555-5555-4555-8555-555555555555';
    const foreignId = '36666666-6666-4666-8666-666666666666';
    await repository.insert(
      entry(incomeId, accountId, ownerId, 'income', '10.25'),
      audit(incomeId, ownerId),
    );
    await repository.insert(
      entry(expenseId, accountId, ownerId, 'expense', '3.10'),
      audit(expenseId, ownerId),
    );
    await repository.insert(
      entry(foreignId, otherAccountId, otherOwnerId, 'income', '99.00'),
      audit(foreignId, otherOwnerId),
    );

    const effects = await repository.sumBalanceEffectsForAccountOwner(
      accountId,
      ownerId,
    );
    expect(
      effects
        .reduce(
          (sum, value) => sum.add(value),
          Money.fromDecimal('0.00', currency),
        )
        .toDecimal(),
    ).toBe('7.15');
    await expect(
      repository.sumBalanceEffectsForAccountOwner(accountId, otherOwnerId),
    ).resolves.toEqual([]);
    expect(
      (
        await repository.listForOwnerBetween(
          ownerId,
          occurredAt,
          new Date(occurredAt.getTime() + 1),
          'active',
          {
            accountId,
            kind: 'expense',
          },
        )
      ).map((item) => item.id),
    ).toEqual([expenseId]);
    await expect(
      repository.listForOwnerBetween(
        ownerId,
        new Date(occurredAt.getTime() - 1),
        occurredAt,
      ),
    ).resolves.toEqual([]);
    await expect(
      repository.listForOwnerBetween(
        otherOwnerId,
        occurredAt,
        new Date(occurredAt.getTime() + 1),
        'active',
        {
          accountId,
        },
      ),
    ).resolves.toEqual([]);
    await expect(
      repository.findByIdForOwner(foreignId, ownerId),
    ).resolves.toBeNull();
  });

  it('persists only initial audit metadata, without transaction amount or private text', async () => {
    const id = '37777777-7777-4777-8777-777777777777';
    await repository.insert(
      entry(id, accountId, ownerId, 'expense', '17.83'),
      audit(id, ownerId),
    );
    const events = await prisma.financialAuditEvent.findMany({
      where: { resourceId: id },
    });
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(
      [
        'action',
        'actorId',
        'id',
        'occurredAt',
        'ownerId',
        'resourceId',
        'resourceType',
        // Allowlisted chain and outcome fields (ADR-036); no amounts or text.
        'correlationId',
        'errorCode',
        'hash',
        'ownerSequence',
        'previousHash',
        'result',
      ].sort(),
    );
    expect(events[0]).toMatchObject({
      action: 'created',
      actorId: ownerId,
      ownerId,
      resourceId: id,
      resourceType: 'transaction',
    });
    const serialized = JSON.stringify(events, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serialized).not.toContain('17.83');
    expect(serialized).not.toContain('Synthetic private description');
  });

  it('rolls back the written transaction and balance effect when audit insertion fails', async () => {
    const id = '38888888-8888-4888-8888-888888888888';
    const existingId = '38888888-8888-4888-8888-888888888889';
    const duplicateAuditId = '38888888-8888-4888-8888-888888888890';
    await repository.insert(
      entry(existingId, accountId, ownerId, 'income', '1.00'),
      audit(existingId, ownerId, 'transaction', duplicateAuditId),
    );
    const before = await repository.sumBalanceEffectsForAccountOwner(
      accountId,
      ownerId,
    );
    await expect(
      repository.insert(
        entry(id, accountId, ownerId, 'expense', '8.00'),
        audit(id, ownerId, 'transaction', duplicateAuditId),
      ),
    ).rejects.toThrow();
    await expect(repository.findByIdForOwner(id, ownerId)).resolves.toBeNull();
    await expect(
      prisma.financialAuditEvent.count({ where: { resourceId: id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.financialAuditEvent.count({ where: { id: duplicateAuditId } }),
    ).resolves.toBe(1);
    expect(
      await repository.sumBalanceEffectsForAccountOwner(accountId, ownerId),
    ).toEqual(before);
  });
});

function entry(
  id: string,
  accountId: string,
  ownerId: string,
  kind: 'income' | 'expense',
  amount: string,
): Transaction {
  return Transaction.create({
    accountId,
    amount: Money.fromDecimal(amount, currency),
    createdAt: occurredAt,
    description: 'Synthetic private description',
    id,
    kind,
    occurredAt,
    ownerId,
  });
}

function audit(
  resourceId: string,
  ownerId: string,
  resourceType: 'account' | 'transaction' = 'transaction',
  id: string = crypto.randomUUID(),
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: ownerId,
    id,
    occurredAt,
    ownerId,
    resourceId,
    resourceType,
  });
}
