import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  Currency,
  FinancialAuditEvent,
  Money,
  Tag,
  Transaction,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import { PrismaTagRepository } from '../classifications/prisma-tag-repository.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from './prisma-transaction-repository.js';
import { PrismaTransactionTagRepository } from './prisma-transaction-tag-repository.js';

describe('PrismaTransactionTagRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let assignments: PrismaTransactionTagRepository | undefined;
  let tags: PrismaTagRepository | undefined;
  let transactions: PrismaTransactionRepository | undefined;
  let accounts: PrismaAccountRepository | undefined;
  let client: ReturnType<typeof createPrismaClient> | undefined;
  let connectionUri: string | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    connectionUri = container.getConnectionUri();
    const migrationPaths = [
      '../../prisma/migrations/20260920040000_create_accounts/migration.sql',
      '../../prisma/migrations/20261015120000_add_account_agency/migration.sql',
      '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
      '../../prisma/migrations/20260920190000_create_tags/migration.sql',
      '../../prisma/migrations/20260920200000_assign_transaction_tags/migration.sql',
      '../../prisma/migrations/20260920180000_create_categories/migration.sql',
      '../../prisma/migrations/20260920210000_create_cost_centers/migration.sql',
      '../../prisma/migrations/20260921010000_assign_transaction_classifications/migration.sql',
      '../../prisma/migrations/20260921110000_add_transaction_observations/migration.sql',
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
      '../../prisma/migrations/20261020130000_tag_lifecycle/migration.sql',
      '../../prisma/migrations/20261005180000_create_counterparties/migration.sql',
      '../../prisma/migrations/20261021180000_counterparty_lifecycle_and_transaction_reference/migration.sql',
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
    client = prisma;
    disconnect = async (): Promise<void> => prisma.$disconnect();
    assignments = new PrismaTransactionTagRepository(prisma);
    tags = new PrismaTagRepository(prisma);
    transactions = new PrismaTransactionRepository(prisma);
    accounts = new PrismaAccountRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('replaces the complete selection atomically and idempotently', async () => {
    if (
      assignments === undefined ||
      tags === undefined ||
      transactions === undefined ||
      accounts === undefined ||
      client === undefined
    ) {
      throw new Error('Repositories were not initialized.');
    }
    const ownerId = 'b36bfe2a-f319-49a8-aade-2a536ea3af38';
    const currency = Currency.create('BRL', 2);
    const account = Account.create({
      color: null,
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
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
      createdAt: new Date('2026-09-20T12:01:00.000Z'),
      description: null,
      id: 'f0ee8a15-69d3-45ca-a172-5f2512ed9fd1',
      kind: 'expense',
      occurredAt: new Date('2026-09-20T11:00:00.000Z'),
      ownerId,
    });
    const first = Tag.create({
      createdAt: new Date('2026-09-20T12:02:00.000Z'),
      id: '79a44112-9757-4230-8065-0bfd0e078355',
      name: 'Essencial',
      ownerId,
    });
    const second = Tag.create({
      createdAt: new Date('2026-09-20T12:03:00.000Z'),
      id: '2359023e-2ed7-45d0-a536-cb961abe3406',
      name: 'Casa',
      ownerId,
    });
    await accounts.insert(account, accountAuditEvent(account));
    await transactions.insert(transaction, auditEvent(transaction));
    await tags.insert(first);
    await tags.insert(second);

    const firstUpdateAudit = updatedAuditEvent(transaction);
    await expect(
      assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [first.id, second.id],
        firstUpdateAudit,
      ),
    ).resolves.toBe('updated');
    await expect(
      assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [second.id],
        updatedAuditEvent(transaction),
      ),
    ).resolves.toBe('updated');
    await expect(
      assignments.listTagIdsForOwner(transaction.id, ownerId),
    ).resolves.toEqual([second.id]);
    await expect(client.financialAuditEvent.count()).resolves.toBe(4);

    const foreignTag = Tag.create({
      createdAt: new Date('2026-09-20T12:03:00.000Z'),
      id: '67fda51c-245b-418e-849f-dae4753d989f',
      name: 'Foreign',
      ownerId: 'e89b6ad0-7838-4a2c-9a21-c775ea78e22a',
    });
    await tags.insert(foreignTag);
    await expect(
      assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [foreignTag.id],
        updatedAuditEvent(transaction),
      ),
    ).resolves.toBe('tag-not-found');
    await expect(
      assignments.listTagIdsForOwner(transaction.id, ownerId),
    ).resolves.toEqual([second.id]);

    await expect(
      assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [second.id],
        updatedAuditEvent(transaction),
      ),
    ).resolves.toBe('unchanged');
    await expect(client.financialAuditEvent.count()).resolves.toBe(4);

    await expect(
      assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [first.id],
        firstUpdateAudit,
      ),
    ).rejects.toThrow();
    await expect(
      assignments.listTagIdsForOwner(transaction.id, ownerId),
    ).resolves.toEqual([second.id]);

    second.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
    await expect(tags.save(second, 1)).resolves.toBe(true);
    await expect(tags.deleteUnlinked(second.id, ownerId, 2)).resolves.toBe(
      'linked',
    );
    await expect(
      assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [second.id],
        updatedAuditEvent(transaction),
      ),
    ).resolves.toBe('unchanged');
    await expect(
      assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [second.id, first.id],
        updatedAuditEvent(transaction),
      ),
    ).resolves.toBe('updated');
    await expect(
      assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [first.id],
        updatedAuditEvent(transaction),
      ),
    ).resolves.toBe('updated');
    await expect(
      assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [second.id],
        updatedAuditEvent(transaction),
      ),
    ).resolves.toBe('tag-not-found');
    await expect(
      assignments.listTagIdsForOwner(transaction.id, ownerId),
    ).resolves.toEqual([first.id]);
    const persisted = await client.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
    });
    expect(persisted.amountMinorUnits.toString()).toBe('1000');
    await expect(tags.deleteUnlinked(second.id, ownerId, 2)).resolves.toBe(
      'deleted',
    );

    if (connectionUri === undefined)
      throw new Error('Database URI was not initialized.');
    const candidate = Tag.create({
      createdAt: new Date('2026-09-20T12:05:00.000Z'),
      id: '32244e5b-e11a-4f36-b8a4-2d94f0518ac3',
      name: 'Candidate',
      ownerId,
    });
    await tags.insert(candidate);
    const blocker = new Client({ connectionString: connectionUri });
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM tags WHERE id = $1 FOR UPDATE', [
        candidate.id,
      ]);
      candidate.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
      const archive = tags.save(candidate, 1);
      await waitForAnotherAdvisoryLock(blocker);
      const link = assignments.replaceForOwner(
        transaction.id,
        ownerId,
        [first.id, candidate.id],
        updatedAuditEvent(transaction),
      );
      await blocker.query('COMMIT');
      await expect(archive).resolves.toBe(true);
      await expect(link).resolves.toBe('tag-not-found');
      await expect(
        assignments.listTagIdsForOwner(transaction.id, ownerId),
      ).resolves.toEqual([first.id]);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
    }
  });
});

async function waitForAnotherAdvisoryLock(client: Client): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()",
    );
    if (Number(result.rows[0]?.count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Concurrent tag archive did not acquire its advisory lock.');
}

function auditEvent(transaction: Transaction): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: transaction.ownerId,
    id: crypto.randomUUID(),
    occurredAt: new Date('2026-09-20T12:01:00.000Z'),
    ownerId: transaction.ownerId,
    resourceId: transaction.id,
    resourceType: 'transaction',
  });
}

function updatedAuditEvent(transaction: Transaction): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'updated',
    actorId: transaction.ownerId,
    id: crypto.randomUUID(),
    occurredAt: new Date('2026-09-20T12:04:00.000Z'),
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
    occurredAt: new Date('2026-09-20T12:00:00.000Z'),
    ownerId: accountValue.ownerId,
    resourceId: accountValue.id,
    resourceType: 'account',
  });
}
