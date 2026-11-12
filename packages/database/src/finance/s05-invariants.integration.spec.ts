import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  ChangeOwnedTransactionLifecycleUseCase,
  ChangeOwnedTransferLifecycleUseCase,
  CreateBalanceAdjustmentUseCase,
  CreateTransactionUseCase,
  CreateTransferUseCase,
  GetOwnedAccountBalanceUseCase,
  IdempotencyConflictError,
  TransactionVersionConflictError,
  type CreateTransferCommand,
} from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  Currency,
  FinancialAuditEvent,
  Money,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import { PrismaBalanceAdjustmentRepository } from '../adjustments/prisma-balance-adjustment-repository.js';
import { PrismaFinancialAuditEventRepository } from '../audit/prisma-financial-audit-event-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';
import { PrismaTransferRepository } from '../transfers/prisma-transfer-repository.js';

/**
 * US-037: S05 invariants exercised through the real use cases and
 * PostgreSQL. Balances are compared with an independent SQL recomputation
 * after every step (INV-006), and the owner audit chain must stay valid.
 */
const ownerId = '37373737-3737-4737-8737-373737373737';
const currency = Currency.create('BRL', 2);
const dayMilliseconds = 24 * 60 * 60 * 1000;

describe('S05 invariants (US-037)', () => {
  let stop: (() => Promise<void>) | undefined;
  let prisma: PrismaClient;
  let accounts: PrismaAccountRepository;
  let transactions: PrismaTransactionRepository;
  let transfers: PrismaTransferRepository;
  let adjustments: PrismaBalanceAdjustmentRepository;
  let auditTrail: PrismaFinancialAuditEventRepository;
  let now = new Date('2026-11-12T12:00:00.000Z');
  const clock = { now: (): Date => new Date(now) };
  const forcedIds: string[] = [];
  const ids = {
    generate: (): string => forcedIds.shift() ?? randomUUID(),
  };

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
    const migrations = new URL('../../prisma/migrations/', import.meta.url);
    for (const name of (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()) {
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'),
      );
    }
    await client.end();
    prisma = createPrismaClient(container.getConnectionUri());
    accounts = new PrismaAccountRepository(prisma);
    transactions = new PrismaTransactionRepository(prisma);
    transfers = new PrismaTransferRepository(prisma);
    adjustments = new PrismaBalanceAdjustmentRepository(prisma);
    auditTrail = new PrismaFinancialAuditEventRepository(prisma);
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await prisma.$disconnect();
    await stop?.();
  });

  async function openAccount(initial: string): Promise<string> {
    const id = randomUUID();
    const value = Account.create({
      color: null,
      createdAt: clock.now(),
      description: null,
      icon: null,
      id,
      initialBalance: Money.fromDecimal(initial, currency),
      institution: null,
      name: 'Conta sintética',
      ownerId,
      type: AccountType.create('checking-account'),
    });
    await accounts.insert(
      value,
      FinancialAuditEvent.create({
        action: 'created',
        actorId: ownerId,
        id: randomUUID(),
        occurredAt: clock.now(),
        ownerId,
        resourceId: id,
        resourceType: 'account',
      }),
    );
    return id;
  }

  /** INV-006: the use case balance equals an independent SQL recomputation. */
  async function balanceOf(accountId: string): Promise<string> {
    const balance = await new GetOwnedAccountBalanceUseCase(
      accounts,
      transactions,
    ).execute(accountId, ownerId);
    const [row] = await prisma.$queryRaw<{ minor: string }[]>`
      SELECT (a.initial_balance_minor_units + COALESCE(SUM(
        CASE
          WHEN t.lifecycle = 'trashed' THEN 0
          WHEN t.kind = 'income' THEN t.amount_minor_units
          ELSE -t.amount_minor_units
        END), 0))::text AS minor
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id AND t.owner_id = a.owner_id
      WHERE a.id = ${accountId}::uuid AND a.owner_id = ${ownerId}::uuid
      GROUP BY a.initial_balance_minor_units`;
    expect(balance.toMinorUnits().toString()).toBe(row?.minor);
    return balance.toDecimal();
  }

  async function auditCount(resourceId: string): Promise<number> {
    return prisma.financialAuditEvent.count({ where: { ownerId, resourceId } });
  }

  function createTransfer(): CreateTransferUseCase {
    return new CreateTransferUseCase(accounts, transfers, clock, ids);
  }

  function transferCommand(
    sourceAccountId: string,
    destinationAccountId: string,
    idempotencyKey: string,
    amount = '20.00',
  ): CreateTransferCommand {
    return {
      actorId: ownerId,
      amount,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: 'Reserva',
      destinationAccountId,
      idempotencyKey,
      observations: null,
      occurredAt: new Date('2026-11-12T11:00:00.000Z'),
      sourceAccountId,
    };
  }

  describe('transfer idempotency (INV-007, INV-008, RII-017)', () => {
    it('replays an identical request, also after a lost response, without a second pair', async () => {
      const source = await openAccount('100.00');
      const destination = await openAccount('0.00');
      const key = randomUUID();
      const first = await createTransfer().execute(
        transferCommand(source, destination, key),
      );
      // The response is lost after commit; the client repeats the command.
      const replayed = await createTransfer().execute(
        transferCommand(source, destination, key.toUpperCase()),
      );

      expect(replayed.id).toBe(first.id);
      await expect(balanceOf(source)).resolves.toBe('80.00');
      await expect(balanceOf(destination)).resolves.toBe('20.00');
      await expect(auditCount(first.id)).resolves.toBe(1);
    });

    it('rejects the same key with a different payload without writing', async () => {
      const source = await openAccount('100.00');
      const destination = await openAccount('0.00');
      const key = randomUUID();
      await createTransfer().execute(transferCommand(source, destination, key));
      const transfersBefore = await prisma.transfer.count({
        where: { ownerId },
      });
      const auditBefore = await prisma.financialAuditEvent.count({
        where: { ownerId },
      });

      await expect(
        createTransfer().execute(
          transferCommand(source, destination, key, '21.00'),
        ),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      await expect(balanceOf(source)).resolves.toBe('80.00');
      await expect(balanceOf(destination)).resolves.toBe('20.00');
      await expect(prisma.transfer.count({ where: { ownerId } })).resolves.toBe(
        transfersBefore,
      );
      await expect(
        prisma.financialAuditEvent.count({ where: { ownerId } }),
      ).resolves.toBe(auditBefore);
    });

    it('writes one pair, one balance effect and one audit event for concurrent requests', async () => {
      const source = await openAccount('100.00');
      const destination = await openAccount('0.00');
      const key = randomUUID();
      const before = await prisma.transfer.count({ where: { ownerId } });

      const outcomes = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          createTransfer().execute(transferCommand(source, destination, key)),
        ),
      );

      const created = outcomes.flatMap((outcome) =>
        outcome.status === 'fulfilled' ? [outcome.value.id] : [],
      );
      expect(new Set(created).size).toBe(1);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(IdempotencyConflictError);
        }
      }
      await expect(prisma.transfer.count({ where: { ownerId } })).resolves.toBe(
        before + 1,
      );
      await expect(balanceOf(source)).resolves.toBe('80.00');
      await expect(balanceOf(destination)).resolves.toBe('20.00');
      await expect(auditCount(created[0] ?? '')).resolves.toBe(1);
    });

    it('releases the key when the write fails before commit', async () => {
      const source = await openAccount('100.00');
      const destination = await openAccount('0.00');
      const key = randomUUID();
      const existingAuditId = (
        await prisma.financialAuditEvent.findFirstOrThrow({
          where: { ownerId },
        })
      ).id;
      // transfer, source leg, destination leg, then a duplicated audit id.
      forcedIds.push(randomUUID(), randomUUID(), randomUUID(), existingAuditId);

      await expect(
        createTransfer().execute(transferCommand(source, destination, key)),
      ).rejects.toThrow();
      await expect(balanceOf(source)).resolves.toBe('100.00');
      await expect(
        prisma.idempotencyRecord.count({ where: { key } }),
      ).resolves.toBe(0);

      await createTransfer().execute(transferCommand(source, destination, key));
      await expect(balanceOf(source)).resolves.toBe('80.00');
    });

    it('replays the original response after a lifecycle change without touching the state', async () => {
      const source = await openAccount('100.00');
      const destination = await openAccount('0.00');
      const key = randomUUID();
      const first = await createTransfer().execute(
        transferCommand(source, destination, key),
      );
      await new ChangeOwnedTransferLifecycleUseCase(
        transfers,
        clock,
        ids,
      ).execute({
        action: 'move-to-trash',
        actorId: ownerId,
        transferId: first.id,
      });
      const auditBefore = await auditCount(first.id);

      const replayed = await createTransfer().execute(
        transferCommand(source, destination, key),
      );

      expect(replayed.id).toBe(first.id);
      expect(replayed.toSnapshot().source.lifecycle).toBe('active');
      const persisted = await transfers.findByIdForOwner(first.id, ownerId);
      expect(persisted?.toSnapshot().source.lifecycle).toBe('trashed');
      await expect(balanceOf(source)).resolves.toBe('100.00');
      await expect(auditCount(first.id)).resolves.toBe(auditBefore);
    });

    it('treats the key as new after the 24 hour replay window', async () => {
      const source = await openAccount('100.00');
      const destination = await openAccount('0.00');
      const key = randomUUID();
      const start = now;
      const first = await createTransfer().execute(
        transferCommand(source, destination, key),
      );
      now = new Date(start.getTime() + dayMilliseconds);
      try {
        const second = await createTransfer().execute(
          transferCommand(source, destination, key),
        );
        expect(second.id).not.toBe(first.id);
        await expect(balanceOf(source)).resolves.toBe('60.00');
      } finally {
        now = start;
      }
    });
  });

  describe('adjustment idempotency (INV-007, RII-017)', () => {
    function createAdjustment(): CreateBalanceAdjustmentUseCase {
      return new CreateBalanceAdjustmentUseCase(
        accounts,
        transactions,
        adjustments,
        clock,
        ids,
      );
    }

    it('replays after the balance moved and records one adjustment under concurrency', async () => {
      const accountId = await openAccount('100.00');
      const key = randomUUID();
      const command = {
        accountId,
        actorId: ownerId,
        idempotencyKey: key,
        justification: 'Conferência do extrato',
        occurredAt: new Date('2026-11-12T11:00:00.000Z'),
        reportedBalance: '90.00',
      };

      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, () => createAdjustment().execute(command)),
      );
      const ids = outcomes.flatMap((outcome) =>
        outcome.status === 'fulfilled' ? [outcome.value.id] : [],
      );
      expect(new Set(ids).size).toBe(1);
      await expect(balanceOf(accountId)).resolves.toBe('90.00');
      await expect(
        prisma.balanceAdjustment.count({ where: { accountId } }),
      ).resolves.toBe(1);

      await new CreateTransactionUseCase(transactions, accounts, clock, {
        generate: () => randomUUID(),
      }).execute({
        accountId,
        actorId: ownerId,
        amount: '5.00',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: null,
        kind: 'expense',
        occurredAt: new Date('2026-11-12T11:30:00.000Z'),
      });
      const replayed = await createAdjustment().execute(command);

      expect(replayed.id).toBe(ids[0]);
      await expect(balanceOf(accountId)).resolves.toBe('85.00');
      await expect(
        createAdjustment().execute({ ...command, reportedBalance: '80.00' }),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      await expect(
        prisma.balanceAdjustment.count({ where: { accountId } }),
      ).resolves.toBe(1);
    });
  });

  describe('archive, trash and restore (INV-006, INV-009, INV-010, US-034)', () => {
    it('keeps the balance exact through the full lifecycle and audits only real changes', async () => {
      const accountId = await openAccount('100.00');
      const expense = await new CreateTransactionUseCase(
        transactions,
        accounts,
        clock,
        ids,
      ).execute({
        accountId,
        actorId: ownerId,
        amount: '25.10',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: null,
        kind: 'expense',
        occurredAt: new Date('2026-11-12T11:00:00.000Z'),
      });
      const change = new ChangeOwnedTransactionLifecycleUseCase(
        transactions,
        transactions,
        clock,
        ids,
      );
      const run = async (
        action:
          'archive' | 'unarchive' | 'move-to-trash' | 'restore-from-trash',
      ): Promise<string> =>
        (
          await change.execute({
            action,
            actorId: ownerId,
            transactionId: expense.id,
          })
        ).lifecycle;

      await expect(balanceOf(accountId)).resolves.toBe('74.90');
      await expect(run('archive')).resolves.toBe('archived');
      await expect(balanceOf(accountId)).resolves.toBe('74.90');
      await expect(run('move-to-trash')).resolves.toBe('trashed');
      await expect(balanceOf(accountId)).resolves.toBe('100.00');
      await expect(run('move-to-trash')).resolves.toBe('trashed');
      await expect(balanceOf(accountId)).resolves.toBe('100.00');
      await expect(run('restore-from-trash')).resolves.toBe('archived');
      await expect(balanceOf(accountId)).resolves.toBe('74.90');
      await expect(run('restore-from-trash')).resolves.toBe('archived');
      await expect(run('unarchive')).resolves.toBe('active');
      await expect(balanceOf(accountId)).resolves.toBe('74.90');

      // created, archived, moved-to-trash, restored-from-trash, unarchived.
      await expect(auditCount(expense.id)).resolves.toBe(5);
      const persisted = await transactions.findByIdForOwner(
        expense.id,
        ownerId,
      );
      expect(persisted?.toSnapshot().version).toBe(5);
    });

    it('applies one restore when restores race, leaving a consistent balance', async () => {
      const accountId = await openAccount('100.00');
      const expense = await new CreateTransactionUseCase(
        transactions,
        accounts,
        clock,
        ids,
      ).execute({
        accountId,
        actorId: ownerId,
        amount: '40.00',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: null,
        kind: 'expense',
        occurredAt: new Date('2026-11-12T11:00:00.000Z'),
      });
      const change = new ChangeOwnedTransactionLifecycleUseCase(
        transactions,
        transactions,
        clock,
        ids,
      );
      await change.execute({
        action: 'move-to-trash',
        actorId: ownerId,
        transactionId: expense.id,
      });
      await expect(balanceOf(accountId)).resolves.toBe('100.00');

      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          change.execute({
            action: 'restore-from-trash',
            actorId: ownerId,
            transactionId: expense.id,
          }),
        ),
      );

      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(
            TransactionVersionConflictError,
          );
        }
      }
      expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(
        true,
      );
      await expect(balanceOf(accountId)).resolves.toBe('60.00');
      const restoredEvents = await prisma.financialAuditEvent.count({
        where: {
          action: 'restored_from_trash',
          ownerId,
          resourceId: expense.id,
        },
      });
      expect(restoredEvents).toBe(1);
    });
  });

  it('keeps the owner audit hash chain valid after every scenario (INV-041, ADR-036)', async () => {
    const verification = await auditTrail.verifyChainForOwner(ownerId);
    expect(verification.firstInvalidSequence).toBeNull();
    expect(verification.checkedEvents).toBe(
      BigInt(await prisma.financialAuditEvent.count({ where: { ownerId } })),
    );
  });
});
