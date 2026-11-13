import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  ChangeOwnedTransactionLifecycleUseCase,
  ChangeOwnedTransferLifecycleUseCase,
  CreateBalanceAdjustmentUseCase,
  CreateTransactionUseCase,
  CreateTransferUseCase,
  EliminateExpiredTrashUseCase,
  EliminateOwnedTrashItemUseCase,
  TrashEliminationBlockedError,
  TrashEliminator,
} from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  Currency,
  FinancialAuditEvent,
  Money,
  SYSTEM_AUDIT_ACTOR_ID,
  TransactionLifecycleError,
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
import { PrismaTrashEliminationRepository } from './prisma-trash-elimination-repository.js';

const ownerId = '34343434-3434-4434-8434-343434343434';
const currency = Currency.create('BRL', 2);
const day = 24 * 60 * 60 * 1000;

describe('trash elimination (US-034, RII-026 option b)', () => {
  let stop: (() => Promise<void>) | undefined;
  let prisma: PrismaClient;
  let accounts: PrismaAccountRepository;
  let transactions: PrismaTransactionRepository;
  let transfers: PrismaTransferRepository;
  let trash: PrismaTrashEliminationRepository;
  let now = new Date('2026-09-01T12:00:00.000Z');
  const clock = { now: (): Date => new Date(now) };
  const ids = { generate: (): string => randomUUID() };

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
    trash = new PrismaTrashEliminationRepository(prisma);
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await prisma.$disconnect();
    await stop?.();
  });

  function eliminator(): TrashEliminator {
    return new TrashEliminator(
      transactions,
      transactions,
      transfers,
      trash,
      clock,
      ids,
    );
  }

  function lifecycle(): ChangeOwnedTransactionLifecycleUseCase {
    return new ChangeOwnedTransactionLifecycleUseCase(
      transactions,
      transactions,
      clock,
      ids,
    );
  }

  async function openAccount(): Promise<string> {
    const id = randomUUID();
    const value = Account.create({
      color: null,
      createdAt: clock.now(),
      description: null,
      icon: null,
      id,
      initialBalance: Money.fromDecimal('100.00', currency),
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

  async function trashedExpense(accountId: string): Promise<string> {
    const created = await new CreateTransactionUseCase(
      transactions,
      accounts,
      clock,
      ids,
    ).execute({
      accountId,
      actorId: ownerId,
      amount: '10.00',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      kind: 'expense',
      occurredAt: clock.now(),
    });
    await lifecycle().execute({
      action: 'move-to-trash',
      actorId: ownerId,
      transactionId: created.id,
    });
    return created.id;
  }

  async function eliminatedEvents(resourceId: string): Promise<number> {
    return prisma.financialAuditEvent.count({
      where: { action: 'eliminated', resourceId },
    });
  }

  it('eliminates a trashed entry for good while keeping its row, balance and audit', async () => {
    const accountId = await openAccount();
    const id = await trashedExpense(accountId);
    const trashedBefore = await transactions.listForAccountOwner(
      accountId,
      ownerId,
      'trashed',
    );
    expect(trashedBefore.map((item) => item.id)).toEqual([id]);

    await new EliminateOwnedTrashItemUseCase(eliminator()).execute({
      actorId: ownerId,
      confirmation: id,
      id,
      resourceType: 'transaction',
    });

    await expect(
      transactions.findByIdForOwner(id, ownerId),
    ).resolves.toBeNull();
    await expect(
      transactions.listForAccountOwner(accountId, ownerId, 'trashed'),
    ).resolves.toEqual([]);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.eliminatedAt).not.toBeNull();
    expect(row.lifecycle).toBe('trashed');
    await expect(eliminatedEvents(id)).resolves.toBe(1);
    await expect(
      new PrismaFinancialAuditEventRepository(prisma).verifyChainForOwner(
        ownerId,
      ),
    ).resolves.toMatchObject({ firstInvalidSequence: null });
  });

  it('refuses entries outside the trash and entries kept by an adjustment', async () => {
    const accountId = await openAccount();
    const active = await new CreateTransactionUseCase(
      transactions,
      accounts,
      clock,
      ids,
    ).execute({
      accountId,
      actorId: ownerId,
      amount: '5.00',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      kind: 'income',
      occurredAt: clock.now(),
    });
    await expect(
      eliminator().eliminateTransaction(active.id, ownerId, ownerId),
    ).rejects.toBeInstanceOf(TransactionLifecycleError);

    const adjustment = await new CreateBalanceAdjustmentUseCase(
      accounts,
      transactions,
      new PrismaBalanceAdjustmentRepository(prisma),
      clock,
      ids,
    ).execute({
      accountId,
      actorId: ownerId,
      idempotencyKey: randomUUID(),
      justification: 'Conferência',
      occurredAt: clock.now(),
      reportedBalance: '90.00',
    });
    await lifecycle().execute({
      action: 'move-to-trash',
      actorId: ownerId,
      transactionId: adjustment.transactionId,
    });
    await expect(
      eliminator().eliminateTransaction(
        adjustment.transactionId,
        ownerId,
        ownerId,
      ),
    ).rejects.toBeInstanceOf(TrashEliminationBlockedError);
    await expect(eliminatedEvents(adjustment.transactionId)).resolves.toBe(0);
  });

  it('eliminates both legs of a trashed transfer together', async () => {
    const source = await openAccount();
    const destination = await openAccount();
    const transfer = await new CreateTransferUseCase(
      accounts,
      transfers,
      clock,
      ids,
    ).execute({
      actorId: ownerId,
      amount: '20.00',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      destinationAccountId: destination,
      idempotencyKey: randomUUID(),
      observations: null,
      occurredAt: clock.now(),
      sourceAccountId: source,
    });
    await new ChangeOwnedTransferLifecycleUseCase(
      transfers,
      clock,
      ids,
    ).execute({
      action: 'move-to-trash',
      actorId: ownerId,
      transferId: transfer.id,
    });

    await new EliminateOwnedTrashItemUseCase(eliminator()).execute({
      actorId: ownerId,
      confirmation: transfer.id,
      id: transfer.id,
      resourceType: 'transfer',
    });

    await expect(
      transfers.findByIdForOwner(transfer.id, ownerId),
    ).resolves.toBeNull();
    const legs = await prisma.transaction.findMany({
      where: {
        id: {
          in: [
            transfer.toSnapshot().source.id,
            transfer.toSnapshot().destination.id,
          ],
        },
      },
    });
    expect(legs.every((leg) => leg.eliminatedAt !== null)).toBe(true);
    await expect(eliminatedEvents(transfer.id)).resolves.toBe(1);
  });

  it('purges only eligible items trashed more than 30 days ago (RNF-056)', async () => {
    const start = new Date('2026-10-01T12:00:00.000Z');
    now = start;
    const accountId = await openAccount();
    const expired = await trashedExpense(accountId);
    const linked = await new CreateBalanceAdjustmentUseCase(
      accounts,
      transactions,
      new PrismaBalanceAdjustmentRepository(prisma),
      clock,
      ids,
    ).execute({
      accountId,
      actorId: ownerId,
      idempotencyKey: randomUUID(),
      justification: 'Conferência',
      occurredAt: clock.now(),
      reportedBalance: '50.00',
    });
    await lifecycle().execute({
      action: 'move-to-trash',
      actorId: ownerId,
      transactionId: linked.transactionId,
    });
    now = new Date(start.getTime() + 20 * day);
    const recent = await trashedExpense(accountId);

    now = new Date(start.getTime() + 31 * day);
    const result = await new EliminateExpiredTrashUseCase(
      trash,
      eliminator(),
      clock,
    ).execute();

    expect(result.eliminated).toBeGreaterThanOrEqual(1);
    await expect(eliminatedEvents(expired)).resolves.toBe(1);
    await expect(eliminatedEvents(recent)).resolves.toBe(0);
    await expect(eliminatedEvents(linked.transactionId)).resolves.toBe(0);
    const purgeEvent = await prisma.financialAuditEvent.findFirstOrThrow({
      where: { action: 'eliminated', resourceId: expired },
    });
    expect(purgeEvent.actorId).toBe(SYSTEM_AUDIT_ACTOR_ID);
    expect(purgeEvent.ownerId).toBe(ownerId);
    await expect(
      transactions.findByIdForOwner(recent, ownerId),
    ).resolves.not.toBeNull();
  });
});
