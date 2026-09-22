import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  Currency,
  FinancialAuditEvent,
  Money,
  Transfer,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransferRepository } from './prisma-transfer-repository.js';

describe('PrismaTransferRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let repository: PrismaTransferRepository | undefined;

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
    repository = new PrismaTransferRepository(prisma);
    const accounts = new PrismaAccountRepository(prisma);
    const source = account('11111111-1111-4111-8111-111111111111');
    const destination = account('22222222-2222-4222-8222-222222222222');
    await accounts.insert(source, accountAuditEvent(source));
    await accounts.insert(destination, accountAuditEvent(destination));
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('commits both entries and rolls both back when the transfer row fails', async () => {
    if (client === undefined || repository === undefined) {
      throw new Error('Transfer persistence is unavailable.');
    }
    const created = transfer(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    );
    await repository.insertAtomically(
      created,
      auditEvent(created, 'created', '10101010-1010-4010-8010-101010101010'),
    );

    await expect(client.transfer.count()).resolves.toBe(1);
    await expect(client.transaction.count()).resolves.toBe(2);
    await expect(client.financialAuditEvent.count()).resolves.toBe(3);

    const duplicate = transfer(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    );
    await expect(
      repository.insertAtomically(
        duplicate,
        auditEvent(
          duplicate,
          'created',
          '20202020-2020-4020-8020-202020202020',
        ),
      ),
    ).rejects.toThrow();
    await expect(client.transfer.count()).resolves.toBe(1);
    await expect(client.transaction.count()).resolves.toBe(2);
    await expect(client.financialAuditEvent.count()).resolves.toBe(3);
  });

  it('restores and updates both entries atomically with optimistic locking', async () => {
    if (client === undefined || repository === undefined) {
      throw new Error('Transfer persistence is unavailable.');
    }
    const transferId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const created = transfer(
      transferId,
      '12121212-1212-4212-8212-121212121212',
      '34343434-3434-4434-8434-343434343434',
    );
    await repository.insertAtomically(
      created,
      auditEvent(created, 'created', '30303030-3030-4030-8030-303030303030'),
    );
    const persisted = await repository.findByIdForOwner(
      transferId,
      '99999999-9999-4999-8999-999999999999',
    );
    if (persisted === null) throw new Error('Transfer was not restored.');
    persisted.moveToTrash(new Date('2026-09-21T13:00:00.000Z'));

    await expect(
      repository.saveAtomically(
        persisted,
        1,
        1,
        auditEvent(
          persisted,
          'moved-to-trash',
          '40404040-4040-4040-8040-404040404040',
        ),
      ),
    ).resolves.toBe(true);
    const trashed = await client.transaction.findMany({
      orderBy: { id: 'asc' },
      where: {
        id: {
          in: [
            persisted.toSnapshot().source.id,
            persisted.toSnapshot().destination.id,
          ],
        },
      },
    });
    expect(trashed).toHaveLength(2);
    expect(
      trashed.every((row) => row.lifecycle === 'trashed' && row.version === 2),
    ).toBe(true);

    persisted.restoreFromTrash(new Date('2026-09-21T14:00:00.000Z'));
    await expect(
      repository.saveAtomically(
        persisted,
        2,
        1,
        auditEvent(
          persisted,
          'restored-from-trash',
          '50505050-5050-4050-8050-505050505050',
        ),
      ),
    ).resolves.toBe(false);
    const rolledBack = await client.transaction.findMany({
      where: {
        id: {
          in: [
            persisted.toSnapshot().source.id,
            persisted.toSnapshot().destination.id,
          ],
        },
      },
    });
    expect(
      rolledBack.every(
        (row) => row.lifecycle === 'trashed' && row.version === 2,
      ),
    ).toBe(true);
    await expect(client.financialAuditEvent.count()).resolves.toBe(5);
  });
});

function account(id: string): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-21T10:00:00.000Z'),
    description: null,
    icon: null,
    id,
    initialBalance: Money.fromDecimal('0.00', Currency.create('BRL', 2)),
    institution: null,
    name: id,
    ownerId: '99999999-9999-4999-8999-999999999999',
    type: AccountType.create('checking-account'),
  });
}

function auditEvent(
  transferValue: Transfer,
  action: 'created' | 'moved-to-trash' | 'restored-from-trash',
  id: string,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId: transferValue.ownerId,
    id,
    occurredAt: new Date('2026-09-21T13:00:00.000Z'),
    ownerId: transferValue.ownerId,
    resourceId: transferValue.id,
    resourceType: 'transfer',
  });
}

function accountAuditEvent(accountValue: Account): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: accountValue.ownerId,
    id: crypto.randomUUID(),
    occurredAt: new Date('2026-09-21T10:00:00.000Z'),
    ownerId: accountValue.ownerId,
    resourceId: accountValue.id,
    resourceType: 'account',
  });
}

function transfer(
  id: string,
  sourceTransactionId: string,
  destinationTransactionId: string,
): Transfer {
  return Transfer.create({
    amount: Money.fromDecimal('10.25', Currency.create('BRL', 2)),
    createdAt: new Date('2026-09-21T12:00:00.000Z'),
    description: 'Synthetic transfer',
    destinationAccountId: '22222222-2222-4222-8222-222222222222',
    destinationTransactionId,
    id,
    observations: null,
    occurredAt: new Date('2026-09-21T11:00:00.000Z'),
    ownerId: '99999999-9999-4999-8999-999999999999',
    sourceAccountId: '11111111-1111-4111-8111-111111111111',
    sourceTransactionId,
  });
}
