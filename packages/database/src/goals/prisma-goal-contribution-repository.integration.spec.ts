import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  ContributionGoalUnavailableError,
  ContributionSourceNotFoundError,
  ContributionSourceUnavailableError,
  ContributionVersionConflictError,
  DistributeContributionUseCase,
  GetContributionUseCase,
  GoalCalendar,
  GoalProgressReader,
  IdempotencyConflictError,
  type DistributeContributionCommand,
} from '@seshat/application';
import { ContributionExceedsSourceError } from '@seshat/domain';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaGoalContributionRepository } from './prisma-goal-contribution-repository.js';
import { PrismaGoalRepository } from './prisma-goal-repository.js';

const ownerId = '55555555-5555-4555-8555-555555555555';
const otherId = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-11-26T15:00:00.000Z');
const clock = { now: (): Date => now };
const identifiers = { generate: (): string => randomUUID() };

describe('goal contributions in PostgreSQL (US-050, INV-025/026)', () => {
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

  const repository = (): PrismaGoalContributionRepository =>
    new PrismaGoalContributionRepository(prisma());

  async function account(owner = ownerId): Promise<string> {
    const id = randomUUID();
    await prisma()
      .$executeRaw`INSERT INTO accounts (id, owner_id, name, type_key, initial_balance_minor_units, currency_code, currency_minor_unit_scale, updated_at) VALUES (${id}::uuid, ${owner}::uuid, 'Synthetic', 'checking-account', 0, 'BRL', 2, ${now})`;
    return id;
  }

  async function entry(
    accountId: string,
    kind: 'income' | 'expense' = 'income',
    owner = ownerId,
  ): Promise<string> {
    const id = randomUUID();
    await prisma().transaction.create({
      data: {
        accountId,
        amountMinorUnits: '10000',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        id,
        kind,
        occurredAt: now,
        ownerId: owner,
        updatedAt: now,
      },
    });
    return id;
  }

  async function goal(lifecycle = 'active', owner = ownerId): Promise<string> {
    const id = randomUUID();
    await prisma().goal.create({
      data: {
        createdAt: now,
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        id,
        initialMinorUnits: '0',
        lifecycle,
        mode: 'free',
        name: 'Meta',
        ownerId: owner,
        targetMinorUnits: '50000',
        updatedAt: now,
        version: 1,
      },
    });
    return id;
  }

  const distribute = (
    sourceTransactionId: string,
    lines: DistributeContributionCommand['lines'],
    change: Partial<DistributeContributionCommand> = {},
  ): ReturnType<DistributeContributionUseCase['execute']> =>
    new DistributeContributionUseCase(repository(), clock, identifiers).execute(
      {
        actorId: ownerId,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        lines,
        sourceTransactionId,
        ...change,
      },
    );

  const ledger = async (): Promise<unknown> =>
    prisma()
      .$queryRaw`SELECT count(*)::int AS n, coalesce(sum(amount_minor_units), 0)::text AS total FROM transactions`;

  async function progressOf(goalId: string): Promise<string | undefined> {
    const goals = new PrismaGoalRepository(prisma());
    const found = await goals.findByIdForOwner(goalId, ownerId);
    if (found === null) throw new Error('missing goal');
    const reader = new GoalProgressReader(
      goals,
      { findOwned: () => Promise.resolve([]) },
      { execute: () => Promise.resolve([]) },
      new GoalCalendar({ findById: () => Promise.resolve(null) }, clock),
      repository(),
    );
    return (
      await reader.view(ownerId, found)
    ).progress.accumulated?.toDecimal();
  }

  it('splits 100 into 60 and 40, keeps the entry and replays by key', async () => {
    const source = await entry(await account());
    const [a, b] = [await goal(), await goal()];
    const before = await ledger();
    const key = randomUUID();
    const lines = [
      { amount: '60.00', goalId: a },
      { amount: '40.00', goalId: b },
    ];

    const view = await distribute(source, lines, { idempotencyKey: key });
    const replay = await distribute(source, lines, { idempotencyKey: key });

    expect(view.allocated.toDecimal()).toBe('100.00');
    expect(view.remaining.toDecimal()).toBe('0.00');
    expect(replay.version).toBe(1);
    expect(await ledger()).toEqual(before);
    expect(await progressOf(a)).toBe('60.00');
    expect(await progressOf(b)).toBe('40.00');
    await expect(
      prisma().financialAuditEvent.count({
        where: { resourceId: source, resourceType: 'goal_contribution' },
      }),
    ).resolves.toBe(1);
    await expect(
      distribute(source, [{ amount: '1.00', goalId: a }], {
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('refuses 70 + 40 over 100 without any line', async () => {
    const source = await entry(await account());
    const [a, b] = [await goal(), await goal()];

    await expect(
      distribute(source, [
        { amount: '70.00', goalId: a },
        { amount: '40.00', goalId: b },
      ]),
    ).rejects.toBeInstanceOf(ContributionExceedsSourceError);
    await expect(
      prisma().goalContributionSource.count({
        where: { sourceTransactionId: source },
      }),
    ).resolves.toBe(0);
  });

  it('lets only one of two concurrent 80 allocations on 100 persist', async () => {
    const source = await entry(await account());
    const [a, b] = [await goal(), await goal()];

    const results = await Promise.allSettled([
      distribute(source, [{ amount: '80.00', goalId: a }]),
      distribute(source, [{ amount: '80.00', goalId: b }]),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ContributionVersionConflictError);
    const total = await prisma().goalContribution.aggregate({
      _sum: { amountMinorUnits: true },
      where: { sourceTransactionId: source },
    });
    expect(total._sum.amountMinorUnits?.toFixed(0)).toBe('8000');
  });

  it('recalculates progress when the entry goes to the trash and keeps the link', async () => {
    const source = await entry(await account());
    const a = await goal();
    await distribute(source, [{ amount: '60.00', goalId: a }]);

    await prisma().transaction.update({
      data: { lifecycle: 'trashed', trashedAt: now },
      where: { id: source },
    });

    expect(await progressOf(a)).toBe('0.00');
    await expect(
      prisma().goalContribution.count({
        where: { sourceTransactionId: source },
      }),
    ).resolves.toBe(1);
    await expect(
      distribute(source, [{ amount: '10.00', goalId: a }], {
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ContributionSourceUnavailableError);
    await prisma().transaction.update({
      data: { lifecycle: 'active', trashedAt: null },
      where: { id: source },
    });
    expect(await progressOf(a)).toBe('60.00');
  });

  it('corrects and removes a distribution with versions', async () => {
    const source = await entry(await account());
    const [a, b] = [await goal(), await goal()];
    await distribute(source, [{ amount: '60.00', goalId: a }]);

    const corrected = await distribute(
      source,
      [
        { amount: '30.00', goalId: a },
        { amount: '30.00', goalId: b },
      ],
      { expectedVersion: 1 },
    );
    const removed = await distribute(source, [], { expectedVersion: 2 });

    expect(corrected.version).toBe(2);
    expect(removed.version).toBe(3);
    expect(removed.remaining.toDecimal()).toBe('100.00');
    await expect(
      new GetContributionUseCase(repository()).execute({
        actorId: ownerId,
        sourceTransactionId: source,
      }),
    ).resolves.toMatchObject({ lines: [], version: 3 });
  });

  it('refuses expenses, refunds, foreign entries and unavailable goals', async () => {
    const accountId = await account();
    const expense = await entry(accountId, 'expense');
    const refundEntry = await entry(accountId);
    await prisma()
      .$executeRaw`INSERT INTO refund_links (id, owner_id, kind, expense_transaction_id, entry_transaction_id, request_fingerprint, idempotency_key, created_at) VALUES (${randomUUID()}::uuid, ${ownerId}::uuid, 'refund', ${expense}::uuid, ${refundEntry}::uuid, ${'0'.repeat(64)}, ${randomUUID()}::uuid, ${now})`;
    const foreign = await entry(await account(otherId), 'income', otherId);
    const source = await entry(accountId);
    const archived = await goal('archived');
    const foreignGoal = await goal('active', otherId);

    for (const id of [expense, refundEntry, foreign]) {
      await expect(
        distribute(id, [{ amount: '1.00', goalId: await goal() }]),
      ).rejects.toBeInstanceOf(ContributionSourceNotFoundError);
    }
    for (const goalId of [archived, foreignGoal]) {
      await expect(
        distribute(source, [{ amount: '1.00', goalId }]),
      ).rejects.toBeInstanceOf(ContributionGoalUnavailableError);
    }
    const sources = await repository().listSources(ownerId);
    expect(sources.map((s) => s.id)).toContain(source);
    expect(sources.map((s) => s.id)).not.toContain(refundEntry);
  });
});
