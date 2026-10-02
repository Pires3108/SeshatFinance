import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { FinancialAuditEvent, ManualExchangeQuote } from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaManualExchangeQuoteRepository } from './prisma-manual-exchange-quote-repository.js';

const ownerId = 'b36bfe2a-f319-49a8-aade-2a536ea3af38';
const otherOwnerId = 'e89b6ad0-7838-4a2c-9a21-c775ea78e22a';
const quoteId = '849857f1-54d6-45c3-8abc-0c127d6bfc98';

function quote(version: number, rate: string): ManualExchangeQuote {
  return ManualExchangeQuote.create({
    authorId: ownerId,
    effectiveAt: new Date('2026-09-30T12:00:00.000Z'),
    id: quoteId,
    ownerId,
    rate,
    recordedAt: new Date(`2026-10-0${String(version)}T12:00:00.000Z`),
    source: 'Synthetic declared quote',
    sourceCurrencyCode: 'USD',
    targetCurrencyCode: 'BRL',
    version,
  });
}

function audit(id: string, action: 'created' | 'updated'): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId: ownerId,
    id,
    occurredAt: new Date('2026-10-01T12:00:00.000Z'),
    ownerId,
    resourceId: quoteId,
    resourceType: 'manual-exchange-quote',
  });
}

describe('PrismaManualExchangeQuoteRepository', () => {
  let client: PrismaClient;
  let disconnect: (() => Promise<void>) | undefined;
  let stop: (() => Promise<void>) | undefined;

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
    try {
      for (const path of [
        '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
        '../../prisma/migrations/20261001010000_create_manual_exchange_quotes/migration.sql',
      ])
        await migration.query(
          await readFile(new URL(path, import.meta.url), 'utf8'),
        );
    } finally {
      await migration.end();
    }
    client = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => client.$disconnect();
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('preserves exact rate, ownership, history and atomic audit under retries', async (): Promise<void> => {
    const repository = new PrismaManualExchangeQuoteRepository(client);
    const first = quote(1, '5.123456789123456789');
    expect(
      await repository.insertVersion(
        first,
        audit('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'created'),
        'create-key',
      ),
    ).toBe(true);
    expect(
      (await repository.findLatestForOwner(quoteId, ownerId))?.toSnapshot(),
    ).toEqual(first.toSnapshot());
    expect(
      await repository.findLatestForOwner(quoteId, otherOwnerId),
    ).toBeNull();
    expect(await repository.listLatestForOwner(otherOwnerId)).toEqual([]);

    const second = quote(2, '5.2');
    expect(
      await repository.insertVersion(
        second,
        audit('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', 'updated'),
        'correct-key',
      ),
    ).toBe(true);
    expect(
      (await repository.findLatestForOwner(quoteId, ownerId))?.toSnapshot()
        .rate,
    ).toBe('5.2');
    expect(
      (await repository.listLatestForOwner(ownerId)).map(
        (item) => item.toSnapshot().version,
      ),
    ).toEqual([2]);
    expect(
      await client.manualExchangeQuoteVersion.count({ where: { quoteId } }),
    ).toBe(2);
    expect(
      (
        await repository.findByIdempotencyKeyForOwner(
          ownerId,
          'created',
          'create-key',
        )
      )?.toSnapshot(),
    ).toEqual(first.toSnapshot());
    expect(
      await repository.findByIdempotencyKeyForOwner(
        otherOwnerId,
        'created',
        'create-key',
      ),
    ).toBeNull();

    expect(
      await repository.insertVersion(
        second,
        audit('cccccccc-cccc-4ccc-cccc-cccccccccccc', 'updated'),
        'correct-key',
      ),
    ).toBe(false);
    expect(
      await client.financialAuditEvent.count({
        where: { resourceId: quoteId },
      }),
    ).toBe(2);
    await expect(
      client.manualExchangeQuoteVersion.update({
        data: { rate: '6' },
        where: { quoteId_version: { quoteId, version: 1 } },
      }),
    ).rejects.toThrow();
    expect(
      (
        await client.manualExchangeQuoteVersion.findUnique({
          where: { quoteId_version: { quoteId, version: 1 } },
        })
      )?.rate,
    ).toBe('5.123456789123456789');
  });
});
