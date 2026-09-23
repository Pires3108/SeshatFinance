import { readFile } from 'node:fs/promises';

import {
  GetOwnedAccountBalanceUseCase,
  OwnedAccountNotFoundError,
} from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  BalanceAdjustment,
  Currency,
  FinancialAuditEvent,
  Money,
  Transfer,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import { PrismaBalanceAdjustmentRepository } from '../adjustments/prisma-balance-adjustment-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';
import { PrismaTransferRepository } from '../transfers/prisma-transfer-repository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const sourceAccountId = '22222222-2222-4222-8222-222222222222';
const destinationAccountId = '33333333-3333-4333-8333-333333333333';
const currency = Currency.create('BRL', 2);

describe('financial ledger across accounts, transfers, and adjustments', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let accounts: PrismaAccountRepository | undefined;
  let transactions: PrismaTransactionRepository | undefined;
  let transfers: PrismaTransferRepository | undefined;
  let adjustments: PrismaBalanceAdjustmentRepository | undefined;

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
    accounts = new PrismaAccountRepository(prisma);
    transactions = new PrismaTransactionRepository(prisma);
    transfers = new PrismaTransferRepository(prisma);
    adjustments = new PrismaBalanceAdjustmentRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('preserves patrimony through pair lifecycle and records one reconciliation', async () => {
    if (
      client === undefined ||
      accounts === undefined ||
      transactions === undefined ||
      transfers === undefined ||
      adjustments === undefined
    ) {
      throw new Error('Financial repositories are unavailable.');
    }
    const source = account(sourceAccountId, '100.00');
    const destination = account(destinationAccountId, '50.00');
    await accounts.insert(
      source,
      audit(
        '44444444-4444-4444-8444-444444444444',
        source.id,
        'account',
        'created',
        '2026-09-23T09:00:00.000Z',
      ),
    );
    await accounts.insert(
      destination,
      audit(
        '55555555-5555-4555-8555-555555555555',
        destination.id,
        'account',
        'created',
        '2026-09-23T09:00:00.000Z',
      ),
    );
    const balances = new GetOwnedAccountBalanceUseCase(accounts, transactions);
    await expectBalances(balances, '100.00', '50.00', '150.00');

    const transfer = Transfer.create({
      amount: Money.fromDecimal('20.00', currency),
      createdAt: new Date('2026-09-23T11:00:00.000Z'),
      description: null,
      destinationAccountId,
      destinationTransactionId: '77777777-7777-4777-8777-777777777777',
      id: '66666666-6666-4666-8666-666666666666',
      observations: null,
      occurredAt: new Date('2026-09-23T10:00:00.000Z'),
      ownerId,
      sourceAccountId,
      sourceTransactionId: '88888888-8888-4888-8888-888888888888',
    });
    await transfers.insertAtomically(
      transfer,
      audit(
        '99999999-9999-4999-8999-999999999999',
        transfer.id,
        'transfer',
        'created',
        '2026-09-23T11:00:00.000Z',
      ),
    );
    await expectBalances(balances, '80.00', '70.00', '150.00');

    const archiveBefore = transfer.toSnapshot();
    transfer.archive(new Date('2026-09-23T12:00:00.000Z'));
    await expect(
      transfers.saveAtomically(
        transfer,
        archiveBefore.source.version,
        archiveBefore.destination.version,
        audit(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          transfer.id,
          'transfer',
          'archived',
          '2026-09-23T12:00:00.000Z',
        ),
      ),
    ).resolves.toBe(true);
    await expectBalances(balances, '80.00', '70.00', '150.00');

    const trashBefore = transfer.toSnapshot();
    transfer.moveToTrash(new Date('2026-09-23T13:00:00.000Z'));
    await expect(
      transfers.saveAtomically(
        transfer,
        trashBefore.source.version,
        trashBefore.destination.version,
        audit(
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          transfer.id,
          'transfer',
          'moved-to-trash',
          '2026-09-23T13:00:00.000Z',
        ),
      ),
    ).resolves.toBe(true);
    await expectBalances(balances, '100.00', '50.00', '150.00');

    const restoreBefore = transfer.toSnapshot();
    transfer.restoreFromTrash(new Date('2026-09-23T14:00:00.000Z'));
    await expect(
      transfers.saveAtomically(
        transfer,
        restoreBefore.source.version,
        restoreBefore.destination.version,
        audit(
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          transfer.id,
          'transfer',
          'restored-from-trash',
          '2026-09-23T14:00:00.000Z',
        ),
      ),
    ).resolves.toBe(true);
    expect(transfer.toSnapshot().source.lifecycle).toBe('archived');
    expect(transfer.toSnapshot().destination.lifecycle).toBe('archived');
    await expectBalances(balances, '80.00', '70.00', '150.00');

    const adjustment = BalanceAdjustment.create({
      accountId: sourceAccountId,
      createdAt: new Date('2026-09-23T15:00:00.000Z'),
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      justification: 'Synthetic statement reconciliation',
      occurredAt: new Date('2026-09-23T15:00:00.000Z'),
      ownerId,
      previousBalance: await balances.execute(sourceAccountId, ownerId),
      reportedBalance: Money.fromDecimal('75.00', currency),
      transactionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    });
    await expect(
      adjustments.insertAtomically(
        adjustment,
        audit(
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
          adjustment.id,
          'balance-adjustment',
          'created',
          '2026-09-23T15:00:00.000Z',
        ),
      ),
    ).resolves.toBe(true);
    await expectBalances(balances, '75.00', '70.00', '145.00');
    expect(
      (
        await adjustments.listForAccountOwner(sourceAccountId, ownerId)
      )[0]?.difference.toDecimal(),
    ).toBe('-5.00');
    await expect(
      balances.execute(sourceAccountId, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(OwnedAccountNotFoundError);
    await expect(client.transaction.count()).resolves.toBe(3);
    await expect(client.financialAuditEvent.count()).resolves.toBe(7);
  });
});

function account(id: string, initialBalance: string): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-23T09:00:00.000Z'),
    description: null,
    icon: null,
    id,
    initialBalance: Money.fromDecimal(initialBalance, currency),
    institution: null,
    name: 'Synthetic account',
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

function audit(
  id: string,
  resourceId: string,
  resourceType: 'account' | 'transfer' | 'balance-adjustment',
  action: 'created' | 'archived' | 'moved-to-trash' | 'restored-from-trash',
  at: string,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId: ownerId,
    id,
    occurredAt: new Date(at),
    ownerId,
    resourceId,
    resourceType,
  });
}

async function expectBalances(
  balances: GetOwnedAccountBalanceUseCase,
  source: string,
  destination: string,
  total: string,
): Promise<void> {
  const [sourceBalance, destinationBalance] = await Promise.all([
    balances.execute(sourceAccountId, ownerId),
    balances.execute(destinationAccountId, ownerId),
  ]);
  expect(sourceBalance.toDecimal()).toBe(source);
  expect(destinationBalance.toDecimal()).toBe(destination);
  expect(sourceBalance.add(destinationBalance).toDecimal()).toBe(total);
}
