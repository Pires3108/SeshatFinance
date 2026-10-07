import { readFile } from 'node:fs/promises';

import type { ExportFilters } from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAdjustmentExportReader } from '../adjustments/prisma-adjustment-export-reader.js';
import { PrismaCardExportReader } from '../cards/prisma-card-export-reader.js';
import {
  PrismaCategoryExportReader,
  PrismaCostCenterExportReader,
  PrismaTagExportReader,
} from '../classifications/prisma-classification-export-reader.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransferExportReader } from './prisma-transfer-export-reader.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const foreignOwnerId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const secondAccountId = '44444444-4444-4444-8444-444444444444';
const createdAt = new Date('2026-10-07T03:00:00.000Z');
const filters: ExportFilters = {
  from: '2026-10-07',
  to: '2026-10-07',
  accountIds: [],
  categoryIds: [],
  entityIds: [],
  includeArchived: false,
  includeTrash: false,
  sets: [
    'transfers',
    'balance_adjustments',
    'categories',
    'tags',
    'cost_centers',
    'credit_cards',
  ],
};

describe('auxiliary PostgreSQL export readers', () => {
  let client: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migration = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migration.connect();
    for (const name of [
      '20260920040000_create_accounts',
      '20260920133000_create_transactions',
      '20260920180000_create_categories',
      '20260920190000_create_tags',
      '20260920200000_assign_transaction_tags',
      '20260920210000_create_cost_centers',
      '20260921010000_assign_transaction_classifications',
      '20260921110000_add_transaction_observations',
      '20260921150000_create_transfers',
      '20260921170000_create_balance_adjustments',
      '20260921210000_create_financial_audit_events',
      '20260922183000_add_credit_card_audit_resource',
      '20260922190000_create_credit_cards',
    ]) {
      await migration.query(
        await readFile(
          new URL(
            `../../prisma/migrations/${name}/migration.sql`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    }
    await migration.end();
    client = createPrismaClient(container.getConnectionUri());
    const accounts: readonly (readonly [string, string])[] = [
      [accountId, ownerId],
      [secondAccountId, ownerId],
      ['55555555-5555-4555-8555-555555555555', foreignOwnerId],
    ];
    for (const [id, owner] of accounts) {
      await client.account.create({
        data: {
          id,
          ownerId: owner,
          name: 'Test',
          typeKey: 'checking',
          initialBalanceMinorUnits: '0',
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          createdAt,
          updatedAt: createdAt,
        },
      });
    }
    const transaction = async (
      id: string,
      owner: string,
      account: string,
    ): Promise<void> => {
      await client.transaction.create({
        data: {
          id,
          ownerId: owner,
          accountId: account,
          kind: 'expense',
          amountMinorUnits: '200',
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          occurredAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
      });
    };
    await transaction(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ownerId,
      accountId,
    );
    await transaction(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ownerId,
      secondAccountId,
    );
    await transaction(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ownerId,
      accountId,
    );
    await transaction(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      foreignOwnerId,
      '55555555-5555-4555-8555-555555555555',
    );
    await client.transfer.create({
      data: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        ownerId,
        sourceTransactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        destinationTransactionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        createdAt,
      },
    });
    await client.balanceAdjustment.create({
      data: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        ownerId,
        accountId,
        transactionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        previousBalanceMinorUnits: '100',
        reportedBalanceMinorUnits: '300',
        differenceMinorUnits: '200',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        justification: 'Synthetic',
        createdAt,
      },
    });
    await client.category.create({
      data: {
        id: '12121212-1212-4212-8212-121212121212',
        ownerId,
        name: 'Category',
        createdAt,
        updatedAt: createdAt,
      },
    });
    await client.tag.create({
      data: {
        id: '13131313-1313-4313-8313-131313131313',
        ownerId,
        name: 'Tag',
        createdAt,
        updatedAt: createdAt,
      },
    });
    await client.costCenter.create({
      data: {
        id: '14141414-1414-4414-8414-141414141414',
        ownerId,
        name: 'Center',
        createdAt,
        updatedAt: createdAt,
      },
    });
    await client.creditCard.create({
      data: {
        id: '15151515-1515-4515-8515-151515151515',
        ownerId,
        paymentAccountId: accountId,
        name: 'Card',
        brand: 'Visa',
        limitMinorUnits: '12345',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        closingDay: 10,
        dueDay: 17,
        createdAt,
      },
    });
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await client.$disconnect();
    await stop();
  });

  it('reads six sets with owner scope and precise money', async () => {
    const readers = [
      new PrismaTransferExportReader(client),
      new PrismaAdjustmentExportReader(client),
      new PrismaCategoryExportReader(client),
      new PrismaTagExportReader(client),
      new PrismaCostCenterExportReader(client),
      new PrismaCardExportReader(client),
    ];
    const results = await Promise.all(
      readers.map((reader) =>
        reader.readAuthorized(ownerId, filters, 'America/Sao_Paulo'),
      ),
    );
    expect(results.map((rows) => rows.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(results[1]?.[0]).toMatchObject({
      difference: { amount: '2.00', currency: 'BRL' },
    });
    expect(results[5]?.[0]).toMatchObject({
      limit: { amount: '123.45', currency: 'BRL' },
    });
    const transfers = new PrismaTransferExportReader(client);
    expect(
      await transfers.readAuthorized(
        ownerId,
        { ...filters, accountIds: [accountId] },
        'America/Sao_Paulo',
      ),
    ).toEqual([]);
    expect(
      await transfers.readAuthorized(
        ownerId,
        { ...filters, accountIds: [accountId, secondAccountId] },
        'America/Sao_Paulo',
      ),
    ).toHaveLength(1);
    const foreign = await Promise.all(
      readers.map((reader) =>
        reader.readAuthorized(foreignOwnerId, filters, 'America/Sao_Paulo'),
      ),
    );
    expect(foreign.every((rows) => rows.length === 0)).toBe(true);
  });
});
