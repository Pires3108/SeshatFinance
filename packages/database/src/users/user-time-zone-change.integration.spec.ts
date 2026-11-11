import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  ListTemporalTransactionsUseCase,
  UpdateOwnUserProfileUseCase,
  type TimeZoneChangeScope,
  type UserProfile,
} from '@seshat/application';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';
import { PrismaUserProfileRepository } from './prisma-user-profile-repository.js';

const saoPaulo = 'America/Sao_Paulo';
const tokyo = 'Asia/Tokyo';
const now = new Date('2026-11-09T12:00:00.000Z');
// 22:30 on 2026-10-31 in Sao Paulo and 10:30 on 2026-11-01 in Tokyo.
const boundaryInstant = new Date('2026-11-01T01:30:00.000Z');

describe('user time zone change', () => {
  let stop: (() => Promise<void>) | undefined;
  let prisma: PrismaClient;
  let profiles: PrismaUserProfileRepository;
  let temporal: ListTemporalTransactionsUseCase;

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
    const entries = await readdir(migrations, { withFileTypes: true });
    for (const name of entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()) {
      await migrationClient.query(
        await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'),
      );
    }
    await migrationClient.end();
    prisma = createPrismaClient(container.getConnectionUri());
    profiles = new PrismaUserProfileRepository(prisma);
    temporal = new ListTemporalTransactionsUseCase(
      new PrismaTransactionRepository(prisma),
      profiles,
    );
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await prisma.$disconnect();
    await stop?.();
  });

  function profile(id: string, timeZone: string): UserProfile {
    return {
      id,
      displayName: 'Pessoa fictícia',
      locale: 'pt-BR',
      presentationCurrency: 'BRL',
      timeZone,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
  }

  async function createOwner(timeZone = saoPaulo): Promise<{
    ownerId: string;
    accountId: string;
  }> {
    const ownerId = randomUUID();
    const accountId = randomUUID();
    await profiles.upsert(profile(ownerId, timeZone));
    await prisma.$executeRaw`INSERT INTO accounts (id, owner_id, name, type_key, initial_balance_minor_units, currency_code, currency_minor_unit_scale, updated_at) VALUES (${accountId}::uuid, ${ownerId}::uuid, 'Synthetic', 'checking-account', 0, 'BRL', 2, ${now})`;
    return { ownerId, accountId };
  }

  async function insertTransaction(
    ownerId: string,
    accountId: string,
    occurredAt = boundaryInstant,
  ): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO transactions (id, owner_id, account_id, kind, amount_minor_units, currency_code, currency_minor_unit_scale, occurred_at, created_at, updated_at) VALUES (${id}::uuid, ${ownerId}::uuid, ${accountId}::uuid, 'expense', 100, 'BRL', 2, ${occurredAt}, ${now}, ${now})`;
    return id;
  }

  function useCase(): UpdateOwnUserProfileUseCase {
    return new UpdateOwnUserProfileUseCase(
      profiles,
      { now: (): Date => now },
      { generate: (): string => randomUUID() },
    );
  }

  function changeZone(
    ownerId: string,
    timeZone: string,
    timeZoneChangeScope: TimeZoneChangeScope,
  ): Promise<UserProfile> {
    return useCase().execute({
      actorId: ownerId,
      displayName: 'Pessoa fictícia',
      locale: 'pt-BR',
      presentationCurrency: 'BRL',
      timeZone,
      timeZoneChangeScope,
    });
  }

  async function dayCount(ownerId: string, date: string): Promise<number> {
    const view = await temporal.execute(ownerId, 'day', date);
    return view.days[0]?.transactions.length ?? 0;
  }

  async function storedZone(id: string): Promise<string> {
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    return row.timeZone;
  }

  it('stamps new rows with the profile zone and falls back without a profile', async () => {
    const { ownerId, accountId } = await createOwner(tokyo);
    await expect(
      storedZone(await insertTransaction(ownerId, accountId)),
    ).resolves.toBe(tokyo);

    const orphanOwner = randomUUID();
    const orphanAccount = randomUUID();
    await prisma.$executeRaw`INSERT INTO accounts (id, owner_id, name, type_key, initial_balance_minor_units, currency_code, currency_minor_unit_scale, updated_at) VALUES (${orphanAccount}::uuid, ${orphanOwner}::uuid, 'Synthetic', 'checking-account', 0, 'BRL', 2, ${now})`;
    await expect(
      storedZone(await insertTransaction(orphanOwner, orphanAccount)),
    ).resolves.toBe(saoPaulo);
  });

  it('reinterprets only the owner rows and records the change', async () => {
    const owner = await createOwner();
    const other = await createOwner();
    const first = await insertTransaction(owner.ownerId, owner.accountId);
    await insertTransaction(owner.ownerId, owner.accountId);
    const foreign = await insertTransaction(other.ownerId, other.accountId);
    const before = await prisma.transaction.findUniqueOrThrow({
      where: { id: first },
    });
    await expect(dayCount(owner.ownerId, '2026-10-31')).resolves.toBe(2);

    const updated = await changeZone(
      owner.ownerId,
      tokyo,
      'reinterpret_existing',
    );

    expect(updated.timeZone).toBe(tokyo);
    expect(updated.version).toBe(2);
    await expect(dayCount(owner.ownerId, '2026-10-31')).resolves.toBe(0);
    await expect(dayCount(owner.ownerId, '2026-11-01')).resolves.toBe(2);
    await expect(storedZone(foreign)).resolves.toBe(saoPaulo);
    const after = await prisma.transaction.findUniqueOrThrow({
      where: { id: first },
    });
    expect(after.occurredAt).toEqual(before.occurredAt);
    expect(after.amountMinorUnits).toEqual(before.amountMinorUnits);
    expect(after.version).toBe(before.version);
    await expect(
      prisma.userTimeZoneChange.findMany({
        where: { ownerId: owner.ownerId },
      }),
    ).resolves.toMatchObject([
      {
        previousTimeZone: saoPaulo,
        newTimeZone: tokyo,
        scope: 'reinterpret_existing',
        affectedTransactions: 2,
      },
    ]);
  });

  it('keeps existing rows and applies the zone to new rows with new_items_only', async () => {
    const { ownerId, accountId } = await createOwner();
    const existing = await insertTransaction(ownerId, accountId);

    await changeZone(ownerId, tokyo, 'new_items_only');
    const created = await insertTransaction(ownerId, accountId);

    await expect(storedZone(existing)).resolves.toBe(saoPaulo);
    await expect(storedZone(created)).resolves.toBe(tokyo);
    await expect(dayCount(ownerId, '2026-10-31')).resolves.toBe(1);
    await expect(dayCount(ownerId, '2026-11-01')).resolves.toBe(1);
    await expect(
      prisma.userTimeZoneChange.findFirstOrThrow({ where: { ownerId } }),
    ).resolves.toMatchObject({
      scope: 'new_items_only',
      affectedTransactions: 0,
    });
  });

  it('does not record a repeated request for the current zone', async () => {
    const { ownerId } = await createOwner();

    await changeZone(ownerId, tokyo, 'new_items_only');
    await changeZone(ownerId, tokyo, 'new_items_only');

    await expect(
      prisma.userTimeZoneChange.count({ where: { ownerId } }),
    ).resolves.toBe(1);
  });

  it('returns null on a stale version and leaves everything unchanged', async () => {
    const { ownerId, accountId } = await createOwner();
    const existing = await insertTransaction(ownerId, accountId);

    await expect(
      profiles.changeTimeZone(profile(ownerId, tokyo), 99, {
        id: randomUUID(),
        ownerId,
        previousTimeZone: saoPaulo,
        newTimeZone: tokyo,
        scope: 'reinterpret_existing',
        changedAt: now,
      }),
    ).resolves.toBeNull();

    await expect(storedZone(existing)).resolves.toBe(saoPaulo);
    await expect(
      prisma.userTimeZoneChange.count({ where: { ownerId } }),
    ).resolves.toBe(0);
  });

  it('rolls back the profile and rows when the audit record fails', async () => {
    const { ownerId, accountId } = await createOwner();
    const existing = await insertTransaction(ownerId, accountId);
    const duplicateId = randomUUID();
    await prisma.userTimeZoneChange.create({
      data: {
        id: duplicateId,
        ownerId: randomUUID(),
        previousTimeZone: saoPaulo,
        newTimeZone: tokyo,
        scope: 'new_items_only',
        affectedTransactions: 0,
        changedAt: now,
      },
    });

    await expect(
      profiles.changeTimeZone(profile(ownerId, tokyo), 1, {
        id: duplicateId,
        ownerId,
        previousTimeZone: saoPaulo,
        newTimeZone: tokyo,
        scope: 'reinterpret_existing',
        changedAt: now,
      }),
    ).rejects.toThrow();

    await expect(storedZone(existing)).resolves.toBe(saoPaulo);
    await expect(profiles.findById(ownerId)).resolves.toMatchObject({
      timeZone: saoPaulo,
      version: 1,
    });
  });

  it('lets only one of two concurrent changes win', async () => {
    const { ownerId } = await createOwner();
    const attempt = (timeZone: string): Promise<UserProfile | null> =>
      profiles.changeTimeZone(profile(ownerId, timeZone), 1, {
        id: randomUUID(),
        ownerId,
        previousTimeZone: saoPaulo,
        newTimeZone: timeZone,
        scope: 'new_items_only',
        changedAt: now,
      });

    const results = await Promise.all([attempt(tokyo), attempt('UTC')]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    await expect(
      prisma.userTimeZoneChange.count({ where: { ownerId } }),
    ).resolves.toBe(1);
  });

  it('does not change the zone through a preference upsert', async () => {
    const { ownerId } = await createOwner();

    await profiles.upsert(profile(ownerId, tokyo));

    await expect(profiles.findById(ownerId)).resolves.toMatchObject({
      timeZone: saoPaulo,
    });
  });

  it('rejects updates and deletes on the audit table', async () => {
    const { ownerId } = await createOwner();
    await changeZone(ownerId, tokyo, 'new_items_only');

    await expect(
      prisma.$executeRaw`UPDATE user_time_zone_changes SET scope = 'reinterpret_existing' WHERE owner_id = ${ownerId}::uuid`,
    ).rejects.toThrow(/append-only/u);
    await expect(
      prisma.$executeRaw`DELETE FROM user_time_zone_changes WHERE owner_id = ${ownerId}::uuid`,
    ).rejects.toThrow(/append-only/u);
  });
});
