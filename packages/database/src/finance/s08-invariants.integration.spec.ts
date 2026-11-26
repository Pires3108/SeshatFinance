import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  ContributionVersionConflictError,
  CreateBudgetUseCase,
  CreateGoalUseCase,
  DistributeContributionUseCase,
  GetAccountAvailabilityUseCase,
  GetOwnedAccountBalanceUseCase,
  GetOwnedAccountUseCase,
  GetOwnedAvailabilitySummaryUseCase,
  GetOwnedBalanceSummaryUseCase,
  BudgetConsumptionReader,
  GoalCalendar,
  GoalProgressReader,
  ListTemporalTransactionsUseCase,
  OwnedGoalAccountDirectory,
  OwnedReserveAccountDirectory,
  SetAccountReserveUseCase,
  TemporalBudgetEntrySource,
  UpdateGoalUseCase,
  type IdempotencyRequest,
  type UserProfileRepository,
} from '@seshat/application';
import { ContributionDistribution, FinancialAuditEvent } from '@seshat/domain';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import { PrismaBudgetRepository } from '../budgets/prisma-budget-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaGoalContributionRepository } from '../goals/prisma-goal-contribution-repository.js';
import { PrismaGoalRepository } from '../goals/prisma-goal-repository.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaAccountReserveRepository } from '../reserves/prisma-account-reserve-repository.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';

/**
 * Sprint 8 regression (US-053): goals, reserves, contributions and budgets
 * run through the real use cases in PostgreSQL, and every step is checked
 * against an independent SQL computation of net worth and allocations.
 */
const ownerId = '12121212-1212-4121-8121-121212121212';
const now = new Date('2026-11-26T15:00:00.000Z');
const clock = { now: (): Date => now };
const identifiers = { generate: (): string => randomUUID() };
const profiles = {
  findById: () => Promise.resolve({ timeZone: 'America/Sao_Paulo' }),
} as unknown as UserProfileRepository;

describe('S08 invariants in PostgreSQL (INV-012/013/025/026/047)', () => {
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

  function kit() {
    const accounts = new PrismaAccountRepository(prisma());
    const transactions = new PrismaTransactionRepository(prisma());
    const owned = new GetOwnedAccountUseCase(accounts);
    const balances = new GetOwnedAccountBalanceUseCase(accounts, transactions);
    const goals = new PrismaGoalRepository(prisma());
    const contributions = new PrismaGoalContributionRepository(prisma());
    const reserves = new PrismaAccountReserveRepository(prisma());
    const calendar = new GoalCalendar(profiles, clock);
    const goalAccounts = new OwnedGoalAccountDirectory(owned, balances);
    const reader = new GoalProgressReader(
      goals,
      goalAccounts,
      { execute: () => Promise.resolve([]) },
      calendar,
      contributions,
    );
    const reserveAccounts = new OwnedReserveAccountDirectory(owned, balances);
    return {
      availability: new GetOwnedAvailabilitySummaryUseCase(
        reserves,
        new GetOwnedBalanceSummaryUseCase(accounts, balances),
      ),
      budgets: new CreateBudgetUseCase(
        new PrismaBudgetRepository(prisma()),
        { isOwned: () => Promise.resolve(true) },
        new BudgetConsumptionReader(
          new TemporalBudgetEntrySource(
            new ListTemporalTransactionsUseCase(transactions, profiles),
          ),
          calendar,
        ),
        calendar,
        identifiers,
      ),
      contributions,
      createGoal: new CreateGoalUseCase(
        goals,
        goalAccounts,
        reader,
        calendar,
        identifiers,
      ),
      distribute: new DistributeContributionUseCase(
        contributions,
        clock,
        identifiers,
      ),
      reserve: new SetAccountReserveUseCase(
        reserves,
        reserveAccounts,
        clock,
        identifiers,
      ),
      reserveView: new GetAccountAvailabilityUseCase(reserves, reserveAccounts),
      updateGoal: new UpdateGoalUseCase(
        goals,
        goalAccounts,
        reader,
        calendar,
        identifiers,
      ),
    };
  }

  /** Independent SQL: initial balances plus effective entries, per currency. */
  async function netWorth(): Promise<string> {
    const [row] = await prisma().$queryRaw<{ total: string }[]>`
      SELECT (
        coalesce((SELECT sum(initial_balance_minor_units) FROM accounts
          WHERE owner_id = ${ownerId}::uuid AND lifecycle <> 'trashed'), 0)
        + coalesce((SELECT sum(CASE WHEN t.kind = 'income'
            THEN t.amount_minor_units ELSE -t.amount_minor_units END)
          FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE t.owner_id = ${ownerId}::uuid
            AND t.lifecycle IN ('active', 'archived')
            AND a.lifecycle <> 'trashed'), 0)
      )::text AS total`;
    return row?.total ?? 'missing';
  }

  async function setup(): Promise<{ accountId: string; incomeId: string }> {
    const accountId = randomUUID();
    await prisma()
      .$executeRaw`INSERT INTO accounts (id, owner_id, name, type_key, initial_balance_minor_units, currency_code, currency_minor_unit_scale, created_at, updated_at) VALUES (${accountId}::uuid, ${ownerId}::uuid, 'Synthetic', 'checking-account', 0, 'BRL', 2, ${now}, ${now})`;
    const incomeId = randomUUID();
    await prisma().transaction.create({
      data: {
        accountId,
        amountMinorUnits: '10000',
        createdAt: now,
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        id: incomeId,
        kind: 'income',
        occurredAt: new Date('2026-11-20T12:00:00.000Z'),
        ownerId,
        updatedAt: now,
      },
    });
    return { accountId, incomeId };
  }

  it('goals, reserves, contributions and budgets never change net worth', async () => {
    const steps = kit();
    const { accountId, incomeId } = await setup();
    const start = await netWorth();
    const goal = await steps.createGoal.execute({
      actorId: ownerId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      idempotencyKey: randomUUID(),
      links: [],
      mode: 'free',
      name: 'Viagem',
      target: '500.00',
    });
    expect(await netWorth()).toBe(start);
    await steps.updateGoal.execute({
      actorId: ownerId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      expectedVersion: 1,
      goalId: goal.goal.id,
      links: [],
      mode: 'free',
      name: 'Viagem longa',
      target: '800.00',
    });
    expect(await netWorth()).toBe(start);

    const reserved = await steps.reserve.execute({
      accountId,
      actorId: ownerId,
      amount: '30.00',
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
    });
    expect(await netWorth()).toBe(start);
    expect(reserved.availability.book.toMinorUnits().toString()).toBe(start);
    expect(
      reserved.availability.available
        .add(reserved.availability.reserved)
        .toMinorUnits()
        .toString(),
    ).toBe(start);

    await steps.distribute.execute({
      actorId: ownerId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      lines: [{ amount: '60.00', goalId: goal.goal.id }],
      sourceTransactionId: incomeId,
    });
    await steps.budgets.execute({
      actorId: ownerId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      dimension: { id: accountId, kind: 'account' },
      idempotencyKey: randomUUID(),
      limit: '50.00',
      name: 'Conta',
    });
    expect(await netWorth()).toBe(start);
  });

  it('two concurrent 80.00 allocations on a 100.00 entry persist at most 100.00', async () => {
    const steps = kit();
    const { incomeId } = await setup();
    const goals = await Promise.all(
      ['A', 'B'].map((name) =>
        steps.createGoal.execute({
          actorId: ownerId,
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          idempotencyKey: randomUUID(),
          links: [],
          mode: 'free',
          name,
          target: '500.00',
        }),
      ),
    );

    const results = await Promise.allSettled(
      goals.map((goal) =>
        steps.distribute.execute({
          actorId: ownerId,
          expectedVersion: 0,
          idempotencyKey: randomUUID(),
          lines: [{ amount: '80.00', goalId: goal.goal.id }],
          sourceTransactionId: incomeId,
        }),
      ),
    );

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ContributionVersionConflictError,
    );
    const [sum] = await prisma().$queryRaw<{ total: string; lines: bigint }[]>`
      SELECT coalesce(sum(amount_minor_units), 0)::text AS total, count(*) AS lines
      FROM goal_contributions WHERE source_transaction_id = ${incomeId}::uuid`;
    expect(sum?.total).toBe('8000');
    expect(sum?.lines).toBe(1n);
  });

  it('a failure in the middle of a write leaves no partial state', async () => {
    const steps = kit();
    const { incomeId } = await setup();
    const goal = await steps.createGoal.execute({
      actorId: ownerId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      idempotencyKey: randomUUID(),
      links: [],
      mode: 'free',
      name: 'Falha',
      target: '500.00',
    });
    const request: IdempotencyRequest = {
      key: randomUUID(),
      operation: 'goal-contribution.distribute',
      ownerId,
      payload: { probe: 'failure' },
      requestedAt: now,
    };
    const auditId = randomUUID();

    await expect(
      steps.contributions.saveAtomically(
        request,
        incomeId,
        0,
        [goal.goal.id],
        (_current, source) => {
          return {
            auditEvent: FinancialAuditEvent.create({
              action: 'created',
              actorId: ownerId,
              id: auditId,
              occurredAt: now,
              ownerId,
              resourceId: incomeId,
              resourceType: 'goal-contribution',
            }),
            distribution: ContributionDistribution.create({
              at: now,
              authorId: ownerId,
              lines: [
                {
                  amount: source.amount,
                  goalId: goal.goal.id,
                },
              ],
              ownerId,
              source: source.amount,
              sourceTransactionId: incomeId,
            }),
          };
        },
        () => {
          throw new Error('Synthetic failure after the lines were written.');
        },
      ),
    ).rejects.toThrow('Synthetic failure');
    await expect(
      prisma().goalContributionSource.count({
        where: { sourceTransactionId: incomeId },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma().goalContribution.count({
        where: { sourceTransactionId: incomeId },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma().financialAuditEvent.count({ where: { id: auditId } }),
    ).resolves.toBe(0);
    await expect(
      prisma().idempotencyRecord.count({ where: { key: request.key } }),
    ).resolves.toBe(0);
  });

  it('archive, trash and restore recalculate availability without losing the reserve', async () => {
    const steps = kit();
    const { accountId } = await setup();
    await steps.reserve.execute({
      accountId,
      actorId: ownerId,
      amount: '40.00',
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
    });
    const line = async (): Promise<string | undefined> =>
      (await steps.availability.execute(ownerId)).accounts
        .find((item) => item.accountId === accountId)
        ?.availability.available.toDecimal();

    expect(await line()).toBe('60.00');
    await prisma()
      .$executeRaw`UPDATE accounts SET lifecycle = 'archived', archived_at = ${now} WHERE id = ${accountId}::uuid`;
    expect(await line()).toBe('60.00');
    await prisma()
      .$executeRaw`UPDATE accounts SET lifecycle = 'trashed', archived_at = NULL, trashed_at = ${now} WHERE id = ${accountId}::uuid`;
    expect(await line()).toBeUndefined();
    await prisma()
      .$executeRaw`UPDATE accounts SET lifecycle = 'active', trashed_at = NULL WHERE id = ${accountId}::uuid`;
    expect(await line()).toBe('60.00');
    await expect(
      steps.reserveView.execute({ accountId, actorId: ownerId }),
    ).resolves.toMatchObject({ reserveVersion: 1 });
  });
});
