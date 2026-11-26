import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  ChangeGoalLifecycleUseCase,
  CreateGoalUseCase,
  GetAccountGoalImpactUseCase,
  GetGoalUseCase,
  GoalAccountUnavailableError,
  GoalCalendar,
  GoalNotFoundError,
  GoalProgressReader,
  GoalShareConflictError,
  GoalShareExceedsBalanceError,
  GoalVersionConflictError,
  IdempotencyConflictError,
  ListGoalsUseCase,
  UpdateGoalUseCase,
  type CreateGoalCommand,
  type GoalAccountDirectory,
  type GoalAccountView,
} from '@seshat/application';
import { Currency, Money } from '@seshat/domain';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaGoalRepository } from './prisma-goal-repository.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const otherId = '88888888-8888-4888-8888-888888888888';
const now = new Date('2026-11-20T15:00:00.000Z');
const brl = Currency.create('BRL', 2);
const usd = Currency.create('USD', 2);

const calendar = new GoalCalendar(
  { findById: () => Promise.resolve(null) },
  { now: () => now },
);
const identifiers = { generate: (): string => randomUUID() };

/** Synthetic accounts with fixed balances; lifecycle can be changed. */
class FakeDirectory implements GoalAccountDirectory {
  public readonly accounts = new Map<
    string,
    GoalAccountView & { ownerId: string }
  >();

  public findOwned(
    ownerId: string,
    accountIds: readonly string[],
  ): Promise<readonly GoalAccountView[]> {
    return Promise.resolve(
      accountIds
        .map((id) => this.accounts.get(id.toLowerCase()))
        .filter(
          (account): account is GoalAccountView & { ownerId: string } =>
            account?.ownerId === ownerId,
        ),
    );
  }
}

describe('goals in PostgreSQL (US-049, RN-069, INV-026)', () => {
  let stop: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  const directory = new FakeDirectory();

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

  function repository(): PrismaGoalRepository {
    return new PrismaGoalRepository(prisma());
  }

  function reader(): GoalProgressReader {
    return new GoalProgressReader(
      repository(),
      directory,
      { execute: () => Promise.resolve([]) },
      calendar,
    );
  }

  async function account(
    balance: string,
    owner = ownerId,
    currency = brl,
  ): Promise<string> {
    const id = randomUUID();
    await prisma()
      .$executeRaw`INSERT INTO accounts (id, owner_id, name, type_key, initial_balance_minor_units, currency_code, currency_minor_unit_scale, updated_at) VALUES (${id}::uuid, ${owner}::uuid, 'Synthetic', 'savings-account', 0, ${currency.code}, ${currency.minorUnitScale}, ${now})`;
    directory.accounts.set(id, {
      balance: Money.fromDecimal(balance, currency),
      id,
      lifecycle: 'active',
      name: 'Synthetic',
      ownerId: owner,
    });
    return id;
  }

  const create = (
    change: Partial<CreateGoalCommand> = {},
  ): ReturnType<CreateGoalUseCase['execute']> =>
    new CreateGoalUseCase(
      repository(),
      directory,
      reader(),
      calendar,
      identifiers,
    ).execute({
      actorId: ownerId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      deadline: '2026-12-31',
      idempotencyKey: randomUUID(),
      links: [],
      mode: 'free',
      name: 'Viagem',
      target: '500.00',
      ...change,
    });

  const amountShare = (accountId: string, amount: string) =>
    ({
      links: [{ accountId, share: { amount, kind: 'amount' } }],
      mode: 'linked',
    }) as const;

  it('creates a free goal without touching balances, transactions or net worth', async () => {
    const before = await prisma().$queryRaw<{ count: bigint }[]>`
      SELECT (SELECT count(*) FROM transactions) + (SELECT count(*) FROM accounts) AS count`;
    const key = randomUUID();

    const view = await create({ idempotencyKey: key });
    const replay = await create({ idempotencyKey: key });
    const after = await prisma().$queryRaw<{ count: bigint }[]>`
      SELECT (SELECT count(*) FROM transactions) + (SELECT count(*) FROM accounts) AS count`;

    expect(replay.goal.id).toBe(view.goal.id);
    expect(after[0]?.count).toBe(before[0]?.count);
    expect(view.progress).toMatchObject({
      percent: '0.00',
      status: 'in-progress',
    });
    await expect(
      prisma().goal.count({ where: { id: view.goal.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma().financialAuditEvent.count({
        where: { resourceId: view.goal.id, resourceType: 'goal' },
      }),
    ).resolves.toBe(1);
    await expect(
      create({ idempotencyKey: key, name: 'Outra' }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('shares an account between goals within its balance and refuses the excess atomically', async () => {
    const accountId = await account('100.00');
    await create(amountShare(accountId, '60.00'));
    const goalsBefore = await prisma().goal.count();

    await expect(
      create(amountShare(accountId, '50.00')),
    ).rejects.toBeInstanceOf(GoalShareExceedsBalanceError);
    expect(await prisma().goal.count()).toBe(goalsBefore);

    const second = await create(amountShare(accountId, '40.00'));
    expect(second.progress.accumulated?.toDecimal()).toBe('40.00');
  });

  it('keeps a full share exclusive', async () => {
    const accountId = await account('100.00');
    await create({
      links: [{ accountId, share: { kind: 'full' } }],
      mode: 'linked',
    });

    await expect(create(amountShare(accountId, '1.00'))).rejects.toBeInstanceOf(
      GoalShareConflictError,
    );
    await expect(
      create({
        links: [{ accountId, share: { kind: 'full' } }],
        mode: 'linked',
      }),
    ).rejects.toBeInstanceOf(GoalShareConflictError);
  });

  it('lets only one of two concurrent shares claim the last part of a balance', async () => {
    const accountId = await account('100.00');

    const results = await Promise.allSettled([
      create(amountShare(accountId, '80.00')),
      create(amountShare(accountId, '80.00')),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      GoalShareExceedsBalanceError,
    );
    await expect(
      prisma().goalAccountLink.count({ where: { accountId } }),
    ).resolves.toBe(1);
  });

  it('keeps the USD value and shows BRL as unavailable without a quote', async () => {
    const accountId = await account('80.00', ownerId, usd);

    const view = await create({
      links: [{ accountId, share: { kind: 'full' } }],
      mode: 'linked',
    });

    expect(view.progress.lines[0]?.counted.toDecimal()).toBe('80.00');
    expect(view.progress.lines[0]?.conversion.status).toBe('unavailable');
    expect(view.progress.accumulated).toBeNull();
    expect(view.progress.status).toBe('indeterminate');
  });

  it('scopes goals and accounts to their owner', async () => {
    const foreign = await account('100.00', otherId);
    const view = await create();

    await expect(
      new GetGoalUseCase(repository(), reader()).execute({
        actorId: otherId,
        goalId: view.goal.id,
      }),
    ).rejects.toBeInstanceOf(GoalNotFoundError);
    await expect(
      create({
        links: [{ accountId: foreign, share: { kind: 'full' } }],
        mode: 'linked',
      }),
    ).rejects.toBeInstanceOf(GoalAccountUnavailableError);
    const listed = await new ListGoalsUseCase(repository(), reader()).execute(
      otherId,
    );
    expect(listed.map((item) => item.goal.id)).not.toContain(view.goal.id);
  });

  it('rejects a stale version and keeps unchanged shares valid after the balance drops', async () => {
    const accountId = await account('100.00');
    const view = await create(amountShare(accountId, '90.00'));
    const update = new UpdateGoalUseCase(
      repository(),
      directory,
      reader(),
      calendar,
      identifiers,
    );
    const command = {
      actorId: ownerId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      deadline: null,
      goalId: view.goal.id,
      name: 'Viagem longa',
      target: '900.00',
      ...amountShare(accountId, '90.00'),
    } as const;
    const stored = directory.accounts.get(accountId);
    if (stored === undefined) throw new Error('missing account');
    directory.accounts.set(accountId, {
      ...stored,
      balance: Money.fromDecimal('50.00', brl),
    });

    const updated = await update.execute({ ...command, expectedVersion: 1 });

    expect(updated.goal.version).toBe(2);
    expect(updated.progress.lines[0]?.belowDeclaredShares).toBe(true);
    expect(updated.progress.lines[0]?.counted.toDecimal()).toBe('50.00');
    await expect(
      update.execute({ ...command, expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(GoalVersionConflictError);
    await expect(
      update.execute({
        ...command,
        expectedVersion: 2,
        ...amountShare(accountId, '95.00'),
      }),
    ).rejects.toBeInstanceOf(GoalShareExceedsBalanceError);
  });

  it('releases shares on archive, claims them again on unarchive and lists the impact', async () => {
    const accountId = await account('100.00');
    const first = await create(amountShare(accountId, '70.00'));
    const lifecycle = new ChangeGoalLifecycleUseCase(
      repository(),
      directory,
      reader(),
      calendar,
      identifiers,
    );
    const impact = new GetAccountGoalImpactUseCase(
      repository(),
      directory,
      reader(),
    );
    expect(
      (await impact.execute({ accountId, actorId: ownerId })).map(
        (v) => v.goal.id,
      ),
    ).toEqual([first.goal.id]);

    await lifecycle.execute({
      action: 'archive',
      actorId: ownerId,
      expectedVersion: 1,
      goalId: first.goal.id,
    });
    expect(await impact.execute({ accountId, actorId: ownerId })).toEqual([]);
    await create(amountShare(accountId, '50.00'));

    await expect(
      lifecycle.execute({
        action: 'unarchive',
        actorId: ownerId,
        expectedVersion: 2,
        goalId: first.goal.id,
      }),
    ).rejects.toBeInstanceOf(GoalShareExceedsBalanceError);
    const stored = await prisma().goal.findUniqueOrThrow({
      where: { id: first.goal.id },
    });
    expect(stored).toMatchObject({ lifecycle: 'archived', version: 2 });
  });
});
