import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaHolidaySettingsRepository } from './prisma-holiday-settings-repository.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const otherId = '88888888-8888-4888-8888-888888888888';

describe('PrismaHolidaySettingsRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let repository: PrismaHolidaySettingsRepository | undefined;

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
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
      '../../prisma/migrations/20261112120000_financial_audit_hash_chain/migration.sql',
      '../../prisma/migrations/20260922183000_add_credit_card_audit_resource/migration.sql',
      '../../prisma/migrations/20260922190000_create_credit_cards/migration.sql',
      '../../prisma/migrations/20261005180000_create_counterparties/migration.sql',
      '../../prisma/migrations/20261021180000_counterparty_lifecycle_and_transaction_reference/migration.sql',
      '../../prisma/migrations/20260919210000_create_user_profiles/migration.sql',
      '../../prisma/migrations/20261109120000_transaction_time_zone/migration.sql',
      '../../prisma/migrations/20261112130000_trash_elimination/migration.sql',
      '../../prisma/migrations/20261113100000_card_cycle_and_holiday_settings/migration.sql',
    ]) {
      await migrationClient.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    }
    await migrationClient.end();
    client = createPrismaClient(container.getConnectionUri());
    repository = new PrismaHolidaySettingsRepository(client);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await client?.$disconnect();
    await stop?.();
  });

  it('returns an unconfigured location before any write', async () => {
    if (repository === undefined) throw unavailable();
    await expect(repository.findForOwner(ownerId)).resolves.toEqual({
      declared: [],
      location: { municipalityCode: null, stateCode: null },
    });
  });

  it('upserts the location per owner', async () => {
    if (repository === undefined) throw unavailable();
    const at = new Date('2026-11-13T12:00:00.000Z');
    await repository.saveLocation(
      ownerId,
      { municipalityCode: null, stateCode: 'RJ' },
      at,
    );
    await repository.saveLocation(
      ownerId,
      { municipalityCode: '3550308', stateCode: 'SP' },
      at,
    );

    expect((await repository.findForOwner(ownerId)).location).toEqual({
      municipalityCode: '3550308',
      stateCode: 'SP',
    });
    expect((await repository.findForOwner(otherId)).location).toEqual({
      municipalityCode: null,
      stateCode: null,
    });
  });

  it('rejects a municipality without state at the database', async () => {
    if (client === undefined) throw unavailable();
    await expect(
      client.userHolidaySettings.create({
        data: {
          municipalityCode: '3550308',
          ownerId: otherId,
          stateCode: null,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('adds, lists and removes declared holidays only for their owner', async () => {
    if (repository === undefined) throw unavailable();
    const id = '77777777-7777-4777-8777-777777777777';
    await repository.addDeclared({
      createdAt: new Date('2026-11-13T12:00:00.000Z'),
      day: 7,
      id,
      month: 3,
      name: 'Festa local',
      ownerId,
      year: null,
    });

    expect((await repository.findForOwner(ownerId)).declared).toMatchObject([
      { day: 7, id, month: 3, name: 'Festa local', year: null },
    ]);
    expect((await repository.findForOwner(otherId)).declared).toEqual([]);
    await expect(repository.removeDeclared(id, otherId)).resolves.toBe(false);
    await expect(repository.removeDeclared(id, ownerId)).resolves.toBe(true);
    expect((await repository.findForOwner(ownerId)).declared).toEqual([]);
  });
});

function unavailable(): Error {
  return new Error('Holiday settings persistence is unavailable.');
}
