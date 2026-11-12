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
import {
  CREATE_TRANSFER_OPERATION,
  IdempotencyConflictError,
  serializeTransferResponse,
  type IdempotentTransferRecord,
} from '@seshat/application';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRunner } from '../prisma/prisma-transaction-runner.js';
import { PrismaTransferRepository } from './prisma-transfer-repository.js';

describe('PrismaTransferRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let repository: PrismaTransferRepository | undefined;
  let transactions: PrismaTransactionRunner | undefined;

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
      '../../prisma/migrations/20261015120000_add_account_agency/migration.sql',
      '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
      '../../prisma/migrations/20260920180000_create_categories/migration.sql',
      '../../prisma/migrations/20260920190000_create_tags/migration.sql',
      '../../prisma/migrations/20260920200000_assign_transaction_tags/migration.sql',
      '../../prisma/migrations/20260920210000_create_cost_centers/migration.sql',
      '../../prisma/migrations/20260921010000_assign_transaction_classifications/migration.sql',
      '../../prisma/migrations/20260921110000_add_transaction_observations/migration.sql',
      '../../prisma/migrations/20260921150000_create_transfers/migration.sql',
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
      '../../prisma/migrations/20261112120000_financial_audit_hash_chain/migration.sql',
      '../../prisma/migrations/20261005180000_create_counterparties/migration.sql',
      '../../prisma/migrations/20261021180000_counterparty_lifecycle_and_transaction_reference/migration.sql',
      '../../prisma/migrations/20260919210000_create_user_profiles/migration.sql',
      '../../prisma/migrations/20261109120000_transaction_time_zone/migration.sql',
      '../../prisma/migrations/20261112090000_idempotency_records/migration.sql',
    ]) {
      await migrationClient.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    }
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    client = prisma;
    disconnect = async (): Promise<void> => prisma.$disconnect();
    transactions = new PrismaTransactionRunner(prisma);
    repository = new PrismaTransferRepository(prisma, transactions);
    const accounts = new PrismaAccountRepository(prisma);
    const source = account('11111111-1111-4111-8111-111111111111');
    const destination = account('22222222-2222-4222-8222-222222222222');
    await accounts.insert(source, accountAuditEvent(source));
    await accounts.insert(destination, accountAuditEvent(destination));
  }, 60_000);

  it('returns committed results and clears its context after errors', async () => {
    if (transactions === undefined)
      throw new Error('Transaction runner unavailable.');
    const runner = transactions;
    const scopes = await Promise.all(
      [0, 1].map(() =>
        runner.run(async () => {
          const scoped = runner.transactionClient;
          await scoped.transfer.count();
          expect(runner.transactionClient).toBe(scoped);
          return scoped;
        }),
      ),
    );
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(() => runner.transactionClient).toThrow(
      'A transaction scope is required.',
    );
    await expect(
      runner.run(async () => runner.transactionClient.transfer.count()),
    ).resolves.toBe(0);
    await expect(
      runner.run(async () => {
        await runner.run(async () => Promise.resolve());
      }),
    ).rejects.toThrow('Nested transaction scopes are not supported.');
    expect(() => runner.transactionClient).toThrow(
      'A transaction scope is required.',
    );
    await expect(
      runner.run(async () => runner.transactionClient.transfer.count()),
    ).resolves.toBe(0);
  });

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
    await insertTransfer(
      repository,
      created,
      auditEvent(created, 'created', '10101010-1010-4010-8010-101010101010'),
    );

    await expect(client.transfer.count()).resolves.toBe(1);
    await expect(client.transaction.count()).resolves.toBe(2);
    await expect(client.financialAuditEvent.count()).resolves.toBe(3);
    expect(
      (
        await repository.listForOwner(
          '99999999-9999-4999-8999-999999999999',
          'active',
        )
      ).map((item) => item.id),
    ).toContain(created.id);
    await expect(
      repository.listForOwner('88888888-8888-4888-8888-888888888888'),
    ).resolves.toEqual([]);
    await expect(
      repository.findByIdForOwner(
        created.id,
        '88888888-8888-4888-8888-888888888888',
      ),
    ).resolves.toBeNull();

    const duplicate = transfer(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    );
    await expect(
      insertTransfer(
        repository,
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
    await insertTransfer(
      repository,
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
    expect(
      (
        await repository.listForOwner(
          '99999999-9999-4999-8999-999999999999',
          'trashed',
        )
      ).map((item) => item.id),
    ).toContain(transferId);
    expect(
      (
        await repository.listForOwner(
          '99999999-9999-4999-8999-999999999999',
          'active',
        )
      ).map((item) => item.id),
    ).not.toContain(transferId);

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

  it('persists only one copy when the same transfer is submitted concurrently', async () => {
    if (client === undefined || repository === undefined) {
      throw new Error('Transfer persistence is unavailable.');
    }
    const beforeTransfers = await client.transfer.count();
    const beforeTransactions = await client.transaction.count();
    const beforeAuditEvents = await client.financialAuditEvent.count();
    const concurrent = transfer(
      '60606060-6060-4060-8060-606060606060',
      '61616161-6161-4161-8161-616161616161',
      '62626262-6262-4262-8262-626262626262',
    );

    const outcomes = await Promise.allSettled([
      insertTransfer(
        repository,
        concurrent,
        auditEvent(
          concurrent,
          'created',
          '63636363-6363-4363-8363-636363636363',
        ),
      ),
      insertTransfer(
        repository,
        concurrent,
        auditEvent(
          concurrent,
          'created',
          '64646464-6464-4464-8464-646464646464',
        ),
      ),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    await expect(client.transfer.count()).resolves.toBe(beforeTransfers + 1);
    await expect(client.transaction.count()).resolves.toBe(
      beforeTransactions + 2,
    );
    await expect(client.financialAuditEvent.count()).resolves.toBe(
      beforeAuditEvents + 1,
    );
  });

  it('applies a concurrent lifecycle change to both entries only once', async () => {
    if (client === undefined || repository === undefined) {
      throw new Error('Transfer persistence is unavailable.');
    }
    const concurrent = transfer(
      '70707070-7070-4070-8070-707070707070',
      '71717171-7171-4171-8171-717171717171',
      '72727272-7272-4272-8272-727272727272',
    );
    await insertTransfer(
      repository,
      concurrent,
      auditEvent(concurrent, 'created', '73737373-7373-4373-8373-737373737373'),
    );
    const first = await repository.findByIdForOwner(
      concurrent.id,
      concurrent.ownerId,
    );
    const second = await repository.findByIdForOwner(
      concurrent.id,
      concurrent.ownerId,
    );
    if (first === null || second === null) {
      throw new Error('Concurrent transfer was not restored.');
    }
    first.moveToTrash(new Date('2026-09-21T15:00:00.000Z'));
    second.moveToTrash(new Date('2026-09-21T15:00:00.000Z'));
    const beforeAuditEvents = await client.financialAuditEvent.count();

    const outcomes = await Promise.all([
      repository.saveAtomically(
        first,
        1,
        1,
        auditEvent(
          first,
          'moved-to-trash',
          '74747474-7474-4474-8474-747474747474',
        ),
      ),
      repository.saveAtomically(
        second,
        1,
        1,
        auditEvent(
          second,
          'moved-to-trash',
          '75757575-7575-4575-8575-757575757575',
        ),
      ),
    ]);

    expect(outcomes.sort()).toEqual([false, true]);
    const rows = await client.transaction.findMany({
      where: {
        id: {
          in: [
            concurrent.toSnapshot().source.id,
            concurrent.toSnapshot().destination.id,
          ],
        },
      },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row) => row.lifecycle === 'trashed' && row.version === 2),
    ).toBe(true);
    await expect(client.financialAuditEvent.count()).resolves.toBe(
      beforeAuditEvents + 1,
    );
  });

  describe('idempotency (US-032, RII-017)', () => {
    async function counts(): Promise<readonly number[]> {
      if (client === undefined) throw new Error('Client unavailable.');
      return Promise.all([
        client.transfer.count(),
        client.transaction.count(),
        client.financialAuditEvent.count(),
        client.idempotencyRecord.count(),
      ]);
    }

    it('replays the stored response for an identical committed request', async () => {
      if (repository === undefined) throw new Error('Repository unavailable.');
      const key = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
      const original = transfer(
        'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2',
        'a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3',
        'a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4',
      );
      const stored = await insertTransfer(
        repository,
        original,
        auditEvent(original, 'created', crypto.randomUUID()),
        idempotencyFor(original, key),
      );
      const before = await counts();
      const retry = transfer(
        'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5',
        'a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6',
        'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7',
      );
      const retryRecord = idempotencyFor(
        retry,
        key,
        new Date('2026-09-22T11:59:59.999Z'),
      );

      await expect(
        repository.findIdempotentResponse(retryRecord.request),
      ).resolves.toBe(stored);
      await expect(
        insertTransfer(
          repository,
          retry,
          auditEvent(retry, 'created', crypto.randomUUID()),
          retryRecord,
        ),
      ).resolves.toBe(stored);
      await expect(counts()).resolves.toEqual(before);
    });

    it('rejects the same key with a different payload without writing', async () => {
      if (repository === undefined) throw new Error('Repository unavailable.');
      const key = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
      const original = transfer(
        'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2',
        'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3',
        'b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4',
      );
      await insertTransfer(
        repository,
        original,
        auditEvent(original, 'created', crypto.randomUUID()),
        idempotencyFor(original, key),
      );
      const before = await counts();
      const divergent = transfer(
        'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5',
        'b6b6b6b6-b6b6-4b6b-8b6b-b6b6b6b6b6b6',
        'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7',
      );
      const divergentRecord = idempotencyFor(
        divergent,
        key,
        undefined,
        '99.99',
      );

      await expect(
        repository.findIdempotentResponse(divergentRecord.request),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      await expect(
        insertTransfer(
          repository,
          divergent,
          auditEvent(divergent, 'created', crypto.randomUUID()),
          divergentRecord,
        ),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      await expect(counts()).resolves.toEqual(before);
    });

    it('writes a single pair when the same key is submitted concurrently', async () => {
      if (repository === undefined) throw new Error('Repository unavailable.');
      const repo = repository;
      const key = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
      const before = await counts();
      const attempts = [1, 2, 3, 4].map((index) => {
        const candidate = transfer(
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID(),
        );
        return insertTransfer(
          repo,
          candidate,
          auditEvent(candidate, 'created', crypto.randomUUID()),
          idempotencyFor(
            candidate,
            key,
            new Date(Date.UTC(2026, 8, 21, 12, 0, index)),
          ),
        );
      });

      const outcomes = await Promise.allSettled(attempts);

      const fulfilled = outcomes.flatMap((outcome) =>
        outcome.status === 'fulfilled' ? [outcome.value] : [],
      );
      const rejected = outcomes.flatMap((outcome) =>
        outcome.status === 'rejected' ? [outcome.reason as unknown] : [],
      );
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(new Set(fulfilled).size).toBe(1);
      expect(
        rejected.every((reason) => reason instanceof IdempotencyConflictError),
      ).toBe(true);
      const after = await counts();
      expect(after).toEqual([
        (before[0] ?? 0) + 1,
        (before[1] ?? 0) + 2,
        (before[2] ?? 0) + 1,
        (before[3] ?? 0) + 1,
      ]);
    });

    it('releases the key when the write fails before commit', async () => {
      if (repository === undefined) throw new Error('Repository unavailable.');
      const key = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
      const existing = transfer(
        'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',
        'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3',
        'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4',
      );
      await insertTransfer(
        repository,
        existing,
        auditEvent(existing, 'created', crypto.randomUUID()),
      );
      const before = await counts();
      const failing = transfer(
        existing.id,
        'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5',
        'd6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6',
      );

      await expect(
        insertTransfer(
          repository,
          failing,
          auditEvent(failing, 'created', crypto.randomUUID()),
          idempotencyFor(failing, key),
        ),
      ).rejects.toThrow();
      await expect(counts()).resolves.toEqual(before);

      const retry = transfer(
        'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7',
        'd8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d8',
        'd9d9d9d9-d9d9-4d9d-8d9d-d9d9d9d9d9d9',
      );
      await expect(
        insertTransfer(
          repository,
          retry,
          auditEvent(retry, 'created', crypto.randomUUID()),
          idempotencyFor(retry, key),
        ),
      ).resolves.toBe(serializeTransferResponse(retry));
    });

    it('treats a key as new after the 24 hour replay window', async () => {
      if (repository === undefined) throw new Error('Repository unavailable.');
      const key = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
      const first = transfer(
        'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2',
        'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3',
        'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4',
      );
      await insertTransfer(
        repository,
        first,
        auditEvent(first, 'created', crypto.randomUUID()),
        idempotencyFor(first, key, new Date('2026-09-21T12:00:00.000Z')),
      );
      const before = await counts();
      const later = transfer(
        'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5',
        'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6',
        'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7',
      );
      const laterRecord = idempotencyFor(
        later,
        key,
        new Date('2026-09-22T12:00:00.000Z'),
        '1.00',
      );

      await expect(
        repository.findIdempotentResponse(laterRecord.request),
      ).resolves.toBeNull();
      await expect(
        insertTransfer(
          repository,
          later,
          auditEvent(later, 'created', crypto.randomUUID()),
          laterRecord,
        ),
      ).resolves.toBe(serializeTransferResponse(later));
      expect(await counts()).toEqual([
        (before[0] ?? 0) + 1,
        (before[1] ?? 0) + 2,
        (before[2] ?? 0) + 1,
        before[3],
      ]);
    });
  });
});

const ownerId = '99999999-9999-4999-8999-999999999999';

function idempotencyFor(
  transferValue: Transfer,
  key: string = crypto.randomUUID(),
  requestedAt = new Date('2026-09-21T12:00:00.000Z'),
  amount = transferValue.toSnapshot().source.amount.amount,
): IdempotentTransferRecord {
  return {
    request: {
      key,
      operation: CREATE_TRANSFER_OPERATION,
      ownerId,
      payload: {
        amount,
        currencyCode: 'BRL',
        destinationAccountId: '22222222-2222-4222-8222-222222222222',
        sourceAccountId: '11111111-1111-4111-8111-111111111111',
      },
      requestedAt,
    },
    response: serializeTransferResponse(transferValue),
  };
}

function insertTransfer(
  repositoryValue: PrismaTransferRepository,
  transferValue: Transfer,
  event: FinancialAuditEvent,
  idempotency: IdempotentTransferRecord = idempotencyFor(transferValue),
): Promise<string> {
  return repositoryValue.insertAtomically(transferValue, event, idempotency);
}

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
