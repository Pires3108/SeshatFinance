import { readFile } from 'node:fs/promises';

import {
  BuildExportUseCase,
  InvalidExportError,
  parseExportSelection,
} from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountExportReader } from '../accounts/prisma-account-export-reader.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionExportReader } from '../transactions/prisma-transaction-export-reader.js';
import { createAuthorizedExportReader } from './authorized-export-reader.js';

const owner = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const ownAccount = '33333333-3333-4333-8333-333333333333';
const foreignAccount = '44444444-4444-4444-8444-444444444444';

describe('authorized export readers', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let prisma: PrismaClient | undefined;

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
      '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
      '../../prisma/migrations/20260920180000_create_categories/migration.sql',
      '../../prisma/migrations/20260920190000_create_tags/migration.sql',
      '../../prisma/migrations/20260920200000_assign_transaction_tags/migration.sql',
      '../../prisma/migrations/20260920210000_create_cost_centers/migration.sql',
      '../../prisma/migrations/20260921010000_assign_transaction_classifications/migration.sql',
      '../../prisma/migrations/20260921110000_add_transaction_observations/migration.sql',
    ])
      await migrationClient.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    await migrationClient.end();
    prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> =>
      prisma?.$disconnect().then(() => undefined);
    for (const [id, ownerId] of [
      [ownAccount, owner],
      [foreignAccount, foreign],
    ] as const) {
      await prisma.account.create({
        data: {
          id,
          ownerId,
          name: 'Synthetic account',
          typeKey: 'checking-account',
          initialBalanceMinorUnits:
            '100000000000000000000000000000000000000001',
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          lifecycle: 'active',
          createdAt: new Date('2026-10-06T00:00:00.000Z'),
          updatedAt: new Date('2026-10-06T00:00:00.000Z'),
        },
      });
    }
    for (const [id, ownerId, accountId] of [
      ['55555555-5555-4555-8555-555555555555', owner, ownAccount],
      ['66666666-6666-4666-8666-666666666666', foreign, foreignAccount],
    ] as const) {
      await prisma.transaction.create({
        data: {
          id,
          ownerId,
          accountId,
          kind: 'expense',
          amountMinorUnits: '1025',
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          description: '=cmd',
          occurredAt: new Date('2026-10-07T01:00:00.000Z'),
          lifecycle: 'active',
          createdAt: new Date('2026-10-07T01:01:00.000Z'),
          updatedAt: new Date('2026-10-07T01:01:00.000Z'),
        },
      });
    }
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('returns only owned accounts and exact large money', async () => {
    if (prisma === undefined) throw new Error('Prisma unavailable.');
    const reader = new PrismaAccountExportReader(prisma);
    const rows = await reader.readAuthorized(
      owner,
      parseExportSelection({ sets: ['accounts'], zone: 'America/Sao_Paulo' })
        .filters,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(ownAccount);
    expect(rows[0]?.initial_balance).toEqual({
      amount: '1000000000000000000000000000000000000000.01',
      currency: 'BRL',
    });
  });

  it('filters owned transactions by civil date in the selected zone', async () => {
    if (prisma === undefined) throw new Error('Prisma unavailable.');
    const reader = new PrismaTransactionExportReader(prisma);
    const today = parseExportSelection({
      sets: ['transactions'],
      zone: 'America/Sao_Paulo',
      from: '2026-10-06',
      to: '2026-10-06',
    }).filters;
    const rows = await reader.readAuthorized(owner, today, 'America/Sao_Paulo');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toEqual({ amount: '10.25', currency: 'BRL' });
    expect(rows[0]?.description).toBe('=cmd');
    const tomorrow = parseExportSelection({
      sets: ['transactions'],
      zone: 'America/Sao_Paulo',
      from: '2026-10-07',
      to: '2026-10-07',
    }).filters;
    await expect(
      reader.readAuthorized(owner, tomorrow, 'America/Sao_Paulo'),
    ).resolves.toEqual([]);
  });

  it('rejects a foreign selected account and includes the referenced owned account', async () => {
    if (prisma === undefined) throw new Error('Prisma unavailable.');
    const useCase = new BuildExportUseCase(
      createAuthorizedExportReader(prisma),
      { now: (): Date => new Date('2026-10-07T03:00:00.000Z') },
    );
    await expect(
      useCase.execute(owner, {
        sets: ['transactions'],
        zone: 'America/Sao_Paulo',
        accountIds: [foreignAccount],
      }),
    ).rejects.toThrow(InvalidExportError);
    const result = await useCase.execute(owner, {
      sets: ['transactions'],
      zone: 'America/Sao_Paulo',
      from: '2026-10-06',
      to: '2026-10-06',
    });
    expect(result.data.transactions).toHaveLength(1);
    expect(result.data.accounts?.[0]?.id).toBe(ownAccount);
    expect(result.reference_inclusions.accounts).toEqual([ownAccount]);
  });
});
