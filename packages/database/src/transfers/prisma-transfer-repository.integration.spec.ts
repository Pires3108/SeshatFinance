import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  Currency,
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
    await accounts.insert(account('11111111-1111-4111-8111-111111111111'));
    await accounts.insert(account('22222222-2222-4222-8222-222222222222'));
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('commits both entries and rolls both back when the transfer row fails', async () => {
    if (client === undefined || repository === undefined) {
      throw new Error('Transfer persistence is unavailable.');
    }
    await repository.insertAtomically(
      transfer(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ),
    );

    await expect(client.transfer.count()).resolves.toBe(1);
    await expect(client.transaction.count()).resolves.toBe(2);

    await expect(
      repository.insertAtomically(
        transfer(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        ),
      ),
    ).rejects.toThrow();
    await expect(client.transfer.count()).resolves.toBe(1);
    await expect(client.transaction.count()).resolves.toBe(2);
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
