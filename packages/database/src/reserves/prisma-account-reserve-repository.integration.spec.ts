import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  AccountReserveVersionConflictError,
  GetAccountAvailabilityUseCase,
  GetOwnedAvailabilitySummaryUseCase,
  IdempotencyConflictError,
  ReserveAccountNotFoundError,
  ReserveAccountUnavailableError,
  SetAccountReserveUseCase,
  type ReserveAccountDirectory,
  type ReserveAccountView,
  type SetAccountReserveCommand,
} from '@seshat/application';
import {
  AccountReserveExceedsBalanceError,
  Currency,
  Money,
} from '@seshat/domain';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaAccountReserveRepository } from './prisma-account-reserve-repository.js';

const ownerId = '77777777-7777-4777-8777-777777777777';
const otherId = '66666666-6666-4666-8666-666666666666';
const now = new Date('2026-11-26T15:00:00.000Z');
const brl = Currency.create('BRL', 2);
const usd = Currency.create('USD', 2);
const clock = { now: (): Date => now };
const identifiers = { generate: (): string => randomUUID() };

/** Synthetic accounts with fixed balances; balance and lifecycle can change. */
class FakeDirectory implements ReserveAccountDirectory {
  public readonly accounts = new Map<
    string,
    ReserveAccountView & { ownerId: string }
  >();

  public findOwned(
    accountId: string,
    ownerId: string,
  ): Promise<ReserveAccountView | null> {
    const account = this.accounts.get(accountId.toLowerCase());
    return Promise.resolve(account?.ownerId === ownerId ? account : null);
  }
}

describe('account reserves in PostgreSQL (US-051, RN-071, INV-012/013)', () => {
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

  function repository(): PrismaAccountReserveRepository {
    return new PrismaAccountReserveRepository(prisma());
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
      ownerId: owner,
    });
    return id;
  }

  const set = (
    accountId: string,
    change: Partial<SetAccountReserveCommand> = {},
  ): ReturnType<SetAccountReserveUseCase['execute']> =>
    new SetAccountReserveUseCase(
      repository(),
      directory,
      clock,
      identifiers,
    ).execute({
      accountId,
      actorId: ownerId,
      amount: '30.00',
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      ...change,
    });

  const ledgerCount = async (): Promise<bigint | undefined> => {
    const rows = await prisma().$queryRaw<{ count: bigint }[]>`
      SELECT (SELECT count(*) FROM transactions)
        + (SELECT count(*) FROM accounts)
        + (SELECT coalesce(sum(initial_balance_minor_units), 0) FROM accounts)::bigint
        AS count`;
    return rows[0]?.count;
  };

  it('reserves 30 of 100 as 70 available without new money, once per key', async () => {
    const accountId = await account('100.00');
    const before = await ledgerCount();
    const key = randomUUID();

    const view = await set(accountId, { idempotencyKey: key });
    const replay = await set(accountId, { idempotencyKey: key });

    expect(view.availability.book.toDecimal()).toBe('100.00');
    expect(view.availability.reserved.toDecimal()).toBe('30.00');
    expect(view.availability.available.toDecimal()).toBe('70.00');
    expect(view.reserveVersion).toBe(1);
    expect(replay.reserveVersion).toBe(1);
    expect(await ledgerCount()).toBe(before);
    await expect(
      prisma().financialAuditEvent.count({
        where: { resourceId: accountId, resourceType: 'account_reserve' },
      }),
    ).resolves.toBe(1);
    await expect(
      set(accountId, { amount: '10.00', idempotencyKey: key }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('removes the reserve, raising available and keeping the book balance', async () => {
    const accountId = await account('100.00');
    await set(accountId);

    const view = await set(accountId, { amount: '0', expectedVersion: 1 });

    expect(view.availability.available.toDecimal()).toBe('100.00');
    expect(view.availability.book.toDecimal()).toBe('100.00');
    expect(view.reserveVersion).toBe(2);
    await expect(
      prisma().financialAuditEvent.count({
        where: { resourceId: accountId, resourceType: 'account_reserve' },
      }),
    ).resolves.toBe(2);
  });

  it('refuses a reserve above the eligible balance without partial effect', async () => {
    const accountId = await account('100.00');

    await expect(set(accountId, { amount: '120.00' })).rejects.toBeInstanceOf(
      AccountReserveExceedsBalanceError,
    );
    await expect(
      prisma().accountReserve.count({ where: { accountId } }),
    ).resolves.toBe(0);
    await expect(
      prisma().financialAuditEvent.count({ where: { resourceId: accountId } }),
    ).resolves.toBe(0);
  });

  it('keeps the reserve when the balance falls and flags it', async () => {
    const accountId = await account('100.00');
    await set(accountId);
    const entry = directory.accounts.get(accountId);
    if (entry === undefined) throw new Error('missing account');
    directory.accounts.set(accountId, {
      ...entry,
      balance: Money.fromDecimal('10.00', brl),
    });

    const view = await new GetAccountAvailabilityUseCase(
      repository(),
      directory,
    ).execute({ accountId, actorId: ownerId });

    expect(view.availability.reserved.toDecimal()).toBe('30.00');
    expect(view.availability.available.toDecimal()).toBe('-20.00');
    expect(view.availability.reserveAboveBalance).toBe(true);
  });

  it('lets only one of two concurrent first declarations win', async () => {
    const accountId = await account('100.00');

    const results = await Promise.allSettled([
      set(accountId, { amount: '80.00' }),
      set(accountId, { amount: '80.00' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(AccountReserveVersionConflictError);
    await expect(
      prisma().accountReserve.findUniqueOrThrow({ where: { accountId } }),
    ).resolves.toMatchObject({ version: 1 });
  });

  it('refuses a stale version, other owners and inactive accounts', async () => {
    const accountId = await account('100.00');
    await set(accountId);
    const foreign = await account('100.00', otherId);

    await expect(
      set(accountId, { amount: '10.00', expectedVersion: 0 }),
    ).rejects.toBeInstanceOf(AccountReserveVersionConflictError);
    await expect(set(foreign)).rejects.toBeInstanceOf(
      ReserveAccountNotFoundError,
    );
    await expect(
      repository().findForOwner(accountId, otherId),
    ).resolves.toBeNull();
    const entry = directory.accounts.get(accountId);
    if (entry === undefined) throw new Error('missing account');
    directory.accounts.set(accountId, { ...entry, lifecycle: 'archived' });
    await expect(
      set(accountId, { amount: '10.00', expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(ReserveAccountUnavailableError);
  });

  it('sums availability per currency and never across currencies', async () => {
    const owner = randomUUID();
    const brlAccount = await account('100.00', owner);
    const usdAccount = await account('50.00', owner, usd);
    const trashed = await account('40.00', owner);
    const setAs = (accountId: string, amount: string): Promise<unknown> =>
      new SetAccountReserveUseCase(
        repository(),
        directory,
        clock,
        identifiers,
      ).execute({
        accountId,
        actorId: owner,
        amount,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      });
    await setAs(brlAccount, '30.00');
    await setAs(usdAccount, '5.00');
    await setAs(trashed, '40.00');

    // The balance summary leaves trashed accounts out (active and archived).
    const summary = await new GetOwnedAvailabilitySummaryUseCase(repository(), {
      execute: () =>
        Promise.resolve({
          accountBalances: [
            {
              accountId: brlAccount,
              balance: Money.fromDecimal('100.00', brl),
            },
            { accountId: usdAccount, balance: Money.fromDecimal('50.00', usd) },
          ],
          brlConsolidation: {
            reason: 'conversion-policy-pending',
            status: 'unavailable',
          },
          totalsByCurrency: [],
        }),
    }).execute(owner);

    expect(summary.accounts).toHaveLength(2);
    expect(
      summary.totalsByCurrency.map((t) => [
        t.book.currency.code,
        t.book.toDecimal(),
        t.reserved.toDecimal(),
        t.available.toDecimal(),
      ]),
    ).toEqual([
      ['BRL', '100.00', '30.00', '70.00'],
      ['USD', '50.00', '5.00', '45.00'],
    ]);
  });
});
