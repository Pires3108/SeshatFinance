import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  BudgetConsumptionReader,
  BudgetOverlapError,
  BudgetVersionConflictError,
  ChangeBudgetLifecycleUseCase,
  ChangeBudgetUseCase,
  CreateBudgetUseCase,
  ListBudgetsUseCase,
  ListTemporalTransactionsUseCase,
  TemporalBudgetEntrySource,
  type BudgetCalendar,
  type CreateBudgetCommand,
  type UserProfileRepository,
} from '@seshat/application';
import { CivilDate } from '@seshat/domain';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';
import { PrismaBudgetRepository } from './prisma-budget-repository.js';

const ownerId = '33333333-3333-4333-8333-333333333333';
const otherId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-26T15:00:00.000Z');
const calendar: BudgetCalendar = {
  now: () => now,
  today: () => Promise.resolve(CivilDate.parse('2026-11-26')),
};
const identifiers = { generate: (): string => randomUUID() };
const profiles = {
  findById: () => Promise.resolve({ timeZone: 'America/Sao_Paulo' }),
} as unknown as UserProfileRepository;

describe('budgets in PostgreSQL (US-052, RF-072)', () => {
  let stop: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;

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
    const migrations = new URL('../../prisma/migrations/', import.meta.url);
    for (const directoryName of (await readdir(migrations)).sort()) {
      if (!/^\d/u.test(directoryName)) continue;
      await migrationClient.query(
        await readFile(
          new URL(`${directoryName}/migration.sql`, migrations),
          'utf8',
        ),
      );
    }
    await migrationClient.end();
    client = createPrismaClient(container.getConnectionUri());
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await client?.$disconnect();
    await stop?.();
  });

  function prisma(): PrismaClient {
    if (client === undefined) throw new Error('PostgreSQL unavailable.');
    return client;
  }

  const repository = (): PrismaBudgetRepository =>
    new PrismaBudgetRepository(prisma());
  const reader = (): BudgetConsumptionReader =>
    new BudgetConsumptionReader(
      new TemporalBudgetEntrySource(
        new ListTemporalTransactionsUseCase(
          new PrismaTransactionRepository(prisma()),
          profiles,
        ),
      ),
      calendar,
    );
  const dimensions = { isOwned: () => Promise.resolve(true) };

  async function account(owner = ownerId): Promise<string> {
    const id = randomUUID();
    await prisma()
      .$executeRaw`INSERT INTO accounts (id, owner_id, name, type_key, initial_balance_minor_units, currency_code, currency_minor_unit_scale, updated_at) VALUES (${id}::uuid, ${owner}::uuid, 'Synthetic', 'checking-account', 0, 'BRL', 2, ${now})`;
    return id;
  }

  async function entry(
    accountId: string,
    amount: string,
    occurredAt: string,
    kind: 'income' | 'expense' = 'expense',
  ): Promise<string> {
    const id = randomUUID();
    await prisma().transaction.create({
      data: {
        accountId,
        amountMinorUnits: amount,
        createdAt: now,
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        id,
        kind,
        occurredAt: new Date(occurredAt),
        ownerId,
        updatedAt: now,
      },
    });
    return id;
  }

  const create = (
    accountId: string,
    change: Partial<CreateBudgetCommand> = {},
  ): ReturnType<CreateBudgetUseCase['execute']> =>
    new CreateBudgetUseCase(
      repository(),
      dimensions,
      reader(),
      calendar,
      identifiers,
    ).execute({
      actorId: ownerId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      dimension: { id: accountId, kind: 'account' },
      idempotencyKey: randomUUID(),
      limit: '500.00',
      name: 'Mercado',
      ...change,
    });

  const list = (month: string): ReturnType<ListBudgetsUseCase['execute']> =>
    new ListBudgetsUseCase(repository(), reader()).execute({
      actorId: ownerId,
      month,
    });

  it('shows 120 realized and 380 remaining, with month bounds in the profile zone', async () => {
    const accountId = await account();
    await entry(accountId, '12000', '2026-11-10T12:00:00.000Z');
    // 2026-11-30 23:30 in São Paulo: still November.
    await entry(accountId, '1000', '2026-12-01T02:30:00.000Z');
    // 2026-12-01 00:30 in São Paulo: next month.
    await entry(accountId, '9900', '2026-12-01T03:30:00.000Z');
    const before = await prisma().transaction.count();

    const view = await create(accountId);
    const [december] = (await list('2026-12')).filter(
      (item) => item.budget.id === view.budget.id,
    );

    expect(view.consumption?.realized.toDecimal()).toBe('130.00');
    expect(view.consumption?.remaining.toDecimal()).toBe('370.00');
    expect(december?.consumption?.realized.toDecimal()).toBe('99.00');
    expect(await prisma().transaction.count()).toBe(before);
    await expect(
      prisma().financialAuditEvent.count({
        where: { resourceId: view.budget.id, resourceType: 'budget' },
      }),
    ).resolves.toBe(1);
  });

  it('warns about the excess and keeps every transaction', async () => {
    const accountId = await account();
    const expense = await entry(accountId, '62000', '2026-11-10T12:00:00.000Z');

    const view = await create(accountId);

    expect(view.consumption).toMatchObject({ exceeded: true });
    expect(view.consumption?.excess.toDecimal()).toBe('120.00');
    await expect(
      prisma().transaction.findUniqueOrThrow({ where: { id: expense } }),
    ).resolves.toMatchObject({ lifecycle: 'active' });
  });

  it('nets a linked refund and ignores transfers out of the account', async () => {
    const accountId = await account();
    const other = await account();
    const expense = await entry(accountId, '20000', '2026-11-05T12:00:00.000Z');
    const refund = await entry(
      accountId,
      '5000',
      '2026-11-06T12:00:00.000Z',
      'income',
    );
    await prisma()
      .$executeRaw`INSERT INTO refund_links (id, owner_id, kind, expense_transaction_id, entry_transaction_id, request_fingerprint, idempotency_key, created_at) VALUES (${randomUUID()}::uuid, ${ownerId}::uuid, 'refund', ${expense}::uuid, ${refund}::uuid, ${'0'.repeat(64)}, ${randomUUID()}::uuid, ${now})`;
    const out = await entry(accountId, '30000', '2026-11-07T12:00:00.000Z');
    const into = await entry(
      other,
      '30000',
      '2026-11-07T12:00:00.000Z',
      'income',
    );
    await prisma()
      .$executeRaw`INSERT INTO transfers (id, owner_id, source_transaction_id, destination_transaction_id, created_at) VALUES (${randomUUID()}::uuid, ${ownerId}::uuid, ${out}::uuid, ${into}::uuid, ${now})`;

    const view = await create(accountId);

    expect(view.consumption?.realized.toDecimal()).toBe('150.00');
  });

  it('refuses a second active budget for the same dimension and currency', async () => {
    const accountId = await account();
    const first = await create(accountId);

    await expect(create(accountId)).rejects.toBeInstanceOf(BudgetOverlapError);
    await new ChangeBudgetLifecycleUseCase(
      repository(),
      reader(),
      calendar,
      identifiers,
    ).execute({
      action: 'archive',
      actorId: ownerId,
      budgetId: first.budget.id,
      expectedVersion: 1,
    });
    await expect(create(accountId)).resolves.toBeDefined();
  });

  it('changes the limit from a later month without rewriting the current one', async () => {
    const accountId = await account();
    const view = await create(accountId);
    const change = new ChangeBudgetUseCase(
      repository(),
      reader(),
      calendar,
      identifiers,
    );

    await change.execute({
      actorId: ownerId,
      budgetId: view.budget.id,
      effectiveFrom: '2027-01',
      expectedVersion: 1,
      limit: '800.00',
      name: 'Mercado',
    });
    const pick = async (month: string): Promise<string | undefined> =>
      (await list(month))
        .find((item) => item.budget.id === view.budget.id)
        ?.consumption?.planned.toDecimal();

    expect(await pick('2026-11')).toBe('500.00');
    expect(await pick('2027-02')).toBe('800.00');
    await expect(
      change.execute({
        actorId: ownerId,
        budgetId: view.budget.id,
        effectiveFrom: '2027-01',
        expectedVersion: 1,
        limit: '900.00',
        name: 'Mercado',
      }),
    ).rejects.toBeInstanceOf(BudgetVersionConflictError);
    await expect(
      repository().findByIdForOwner(view.budget.id, otherId),
    ).resolves.toBeNull();
  });
});
