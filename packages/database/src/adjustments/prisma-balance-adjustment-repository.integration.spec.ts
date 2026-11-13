import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  CREATE_BALANCE_ADJUSTMENT_OPERATION,
  IdempotencyConflictError,
  serializeBalanceAdjustmentResponse,
  type IdempotentBalanceAdjustmentRecord,
} from '@seshat/application';
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
const idempotencyAccountId = '22222222-2222-4222-8222-222222222222';
const currency = Currency.create('BRL', 2);
const requestedAt = new Date('2026-09-21T12:00:00.000Z');

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
      '../../prisma/migrations/20261015120000_add_account_agency/migration.sql',
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
      '../../prisma/migrations/20261112120000_financial_audit_hash_chain/migration.sql',
      '../../prisma/migrations/20261005180000_create_counterparties/migration.sql',
      '../../prisma/migrations/20261021180000_counterparty_lifecycle_and_transaction_reference/migration.sql',
      '../../prisma/migrations/20260919210000_create_user_profiles/migration.sql',
      '../../prisma/migrations/20261109120000_transaction_time_zone/migration.sql',
      '../../prisma/migrations/20261112090000_idempotency_records/migration.sql',
      '../../prisma/migrations/20261112130000_trash_elimination/migration.sql',
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
    const accounts = new PrismaAccountRepository(prisma);
    for (const persistedAccount of [
      account(accountId),
      account(idempotencyAccountId),
    ]) {
      await accounts.insert(
        persistedAccount,
        accountAuditEvent(persistedAccount),
      );
    }
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('inserts the entry and audit metadata in one transaction', async () => {
    if (client === undefined || repository === undefined) throw unavailable();

    const created = adjustment('100.00', '125.50');
    const idempotency = idempotencyFor(created);
    await expect(
      repository.insertAtomically(
        created,
        adjustmentAuditEvent(created, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        idempotency,
      ),
    ).resolves.toBe(idempotency.response);
    await expect(client.transaction.count()).resolves.toBe(1);
    await expect(client.financialAuditEvent.count()).resolves.toBe(3);
    await expect(client.idempotencyRecord.count()).resolves.toBe(1);
    const row = await client.balanceAdjustment.findFirstOrThrow();
    expect(row.justification).toBe('Synthetic reconciliation');
    expect(row.previousBalanceMinorUnits.toFixed(0)).toBe('10000');
    expect(row.reportedBalanceMinorUnits.toFixed(0)).toBe('12550');
    expect(row.differenceMinorUnits.toFixed(0)).toBe('2550');
  });

  it('reads exact reconciliation history for the owner only', async () => {
    if (repository === undefined) throw unavailable();

    const items = await repository.listForAccountOwner(accountId, ownerId);
    expect(items).toHaveLength(1);
    expect(items[0]?.previousBalance.toDecimal()).toBe('100.00');
    expect(items[0]?.reportedBalance.toDecimal()).toBe('125.50');
    expect(items[0]?.difference.toDecimal()).toBe('25.50');
    expect(items[0]?.transactionKind).toBe('income');
    await expect(
      repository.listForAccountOwner(
        accountId,
        '88888888-8888-4888-8888-888888888888',
      ),
    ).resolves.toEqual([]);
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

    const beforeIdempotency = await client.idempotencyRecord.count();

    const stale = adjustment('125.50', '130.00');
    await expect(
      repository.insertAtomically(
        stale,
        adjustmentAuditEvent(stale, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        idempotencyFor(stale),
      ),
    ).resolves.toBeNull();
    await expect(client.idempotencyRecord.count()).resolves.toBe(
      beforeIdempotency,
    );
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
        idempotencyFor(auditFailure),
      ),
    ).rejects.toThrow();
    await expect(client.transaction.count()).resolves.toBe(beforeTransactions);
    await expect(client.balanceAdjustment.count()).resolves.toBe(
      beforeAdjustments,
    );
    await expect(client.idempotencyRecord.count()).resolves.toBe(
      beforeIdempotency,
    );
  });

  it('allows only one concurrent adjustment for the same previous balance', async () => {
    if (client === undefined || repository === undefined) throw unavailable();
    const beforeTransactions = await client.transaction.count();
    const beforeAdjustments = await client.balanceAdjustment.count();
    const beforeAuditEvents = await client.financialAuditEvent.count();
    const first = adjustment('130.50', '140.00');
    const second = adjustment('130.50', '150.00');

    const outcomes = await Promise.all([
      repository.insertAtomically(
        first,
        adjustmentAuditEvent(first, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        idempotencyFor(first),
      ),
      repository.insertAtomically(
        second,
        adjustmentAuditEvent(second, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
        idempotencyFor(second),
      ),
    ]);

    expect(outcomes.map((outcome) => outcome !== null).sort()).toEqual([
      false,
      true,
    ]);
    await expect(client.transaction.count()).resolves.toBe(
      beforeTransactions + 1,
    );
    await expect(client.balanceAdjustment.count()).resolves.toBe(
      beforeAdjustments + 1,
    );
    await expect(client.financialAuditEvent.count()).resolves.toBe(
      beforeAuditEvents + 1,
    );
  });

  describe('idempotency (US-033, RII-017)', () => {
    async function counts(): Promise<readonly number[]> {
      if (client === undefined) throw unavailable();
      return Promise.all([
        client.transaction.count(),
        client.balanceAdjustment.count(),
        client.financialAuditEvent.count(),
        client.idempotencyRecord.count(),
      ]);
    }

    it('replays the stored response before re-checking a balance that already moved', async () => {
      if (repository === undefined) throw unavailable();
      const key = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
      const original = adjustment('100.00', '110.00', idempotencyAccountId);
      const idempotency = idempotencyFor(original, key);
      await expect(
        repository.insertAtomically(
          original,
          adjustmentAuditEvent(original, crypto.randomUUID()),
          idempotency,
        ),
      ).resolves.toBe(idempotency.response);
      const before = await counts();

      const repeated = adjustment('100.00', '110.00', idempotencyAccountId);
      await expect(
        repository.insertAtomically(
          repeated,
          adjustmentAuditEvent(repeated, crypto.randomUUID()),
          idempotencyFor(repeated, key),
        ),
      ).resolves.toBe(idempotency.response);
      await expect(
        repository.findIdempotentResponse(idempotency.request),
      ).resolves.toBe(idempotency.response);
      await expect(counts()).resolves.toEqual(before);
    });

    it('rejects the same key with a different reported balance without writing', async () => {
      if (repository === undefined) throw unavailable();
      const before = await counts();
      const divergent = adjustment('110.00', '120.00', idempotencyAccountId);

      await expect(
        repository.insertAtomically(
          divergent,
          adjustmentAuditEvent(divergent, crypto.randomUUID()),
          idempotencyFor(divergent, 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'),
        ),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      await expect(counts()).resolves.toEqual(before);
    });

    it('writes a single adjustment when the same key is submitted concurrently', async () => {
      if (repository === undefined) throw unavailable();
      const repo = repository;
      const key = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
      const before = await counts();

      const outcomes = await Promise.allSettled(
        [1, 2, 3, 4].map(() => {
          const candidate = adjustment(
            '110.00',
            '115.00',
            idempotencyAccountId,
          );
          return repo.insertAtomically(
            candidate,
            adjustmentAuditEvent(candidate, crypto.randomUUID()),
            idempotencyFor(candidate, key),
          );
        }),
      );

      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled',
      );
      const rejected = outcomes.filter(
        (outcome) => outcome.status === 'rejected',
      );
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(new Set(fulfilled.map((outcome) => outcome.value)).size).toBe(1);
      for (const outcome of rejected) {
        expect(outcome.reason).toBeInstanceOf(IdempotencyConflictError);
      }
      const after = await counts();
      expect(after).toEqual(before.map((count) => count + 1));
    });

    it('releases the key when the write fails before commit', async () => {
      if (repository === undefined) throw unavailable();
      const key = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';
      const before = await counts();
      const failing = adjustment('115.00', '120.00', idempotencyAccountId);

      await expect(
        repository.insertAtomically(
          failing,
          adjustmentAuditEvent(failing, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
          idempotencyFor(failing, key),
        ),
      ).rejects.toThrow();
      await expect(counts()).resolves.toEqual(before);

      const retried = adjustment('115.00', '120.00', idempotencyAccountId);
      const idempotency = idempotencyFor(retried, key);
      await expect(
        repository.insertAtomically(
          retried,
          adjustmentAuditEvent(retried, crypto.randomUUID()),
          idempotency,
        ),
      ).resolves.toBe(idempotency.response);
    });

    it('treats a key as new after the 24 hour replay window', async () => {
      if (client === undefined || repository === undefined) {
        throw unavailable();
      }
      const key = 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4';
      const first = adjustment('120.00', '125.00', idempotencyAccountId);
      await repository.insertAtomically(
        first,
        adjustmentAuditEvent(first, crypto.randomUUID()),
        idempotencyFor(first, key),
      );
      const beforeAdjustments = await client.balanceAdjustment.count();
      const beforeRecords = await client.idempotencyRecord.count();

      const later = adjustment('125.00', '130.00', idempotencyAccountId);
      const laterIdempotency = {
        request: {
          ...idempotencyFor(first, key).request,
          requestedAt: new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000),
        },
        response: serializeBalanceAdjustmentResponse(later),
      };
      await expect(
        repository.insertAtomically(
          later,
          adjustmentAuditEvent(later, crypto.randomUUID()),
          laterIdempotency,
        ),
      ).resolves.toBe(laterIdempotency.response);
      await expect(client.balanceAdjustment.count()).resolves.toBe(
        beforeAdjustments + 1,
      );
      await expect(client.idempotencyRecord.count()).resolves.toBe(
        beforeRecords,
      );
    });
  });
});

function idempotencyFor(
  adjustmentValue: BalanceAdjustment,
  key: string = crypto.randomUUID(),
): IdempotentBalanceAdjustmentRecord {
  const snapshot = adjustmentValue.toSnapshot();
  return {
    request: {
      key,
      operation: CREATE_BALANCE_ADJUSTMENT_OPERATION,
      ownerId: snapshot.ownerId,
      payload: {
        accountId: snapshot.transaction.accountId,
        justification: snapshot.justification,
        occurredAt: snapshot.transaction.occurredAt.toISOString(),
        reportedBalance: snapshot.reportedBalance.amount,
      },
      requestedAt,
    },
    response: serializeBalanceAdjustmentResponse(adjustmentValue),
  };
}

function account(id: string): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-21T10:00:00.000Z'),
    description: null,
    icon: null,
    id,
    initialBalance: Money.fromDecimal('100.00', currency),
    institution: null,
    name: 'Synthetic account',
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

function adjustment(
  previous: string,
  reported: string,
  adjustmentAccountId: string = accountId,
): BalanceAdjustment {
  return BalanceAdjustment.create({
    accountId: adjustmentAccountId,
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

function unavailable(): Error {
  return new Error('Balance adjustment persistence is unavailable.');
}
