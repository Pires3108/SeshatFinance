import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  Currency,
  FinancialAuditEvent,
  Money,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../prisma/create-prisma-client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaAccountRepository } from './prisma-account-repository.js';

describe('PrismaAccountRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let repository: PrismaAccountRepository | undefined;

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
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
    ]) {
      await migrationClient.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    }
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    client = prisma;
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaAccountRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('round-trips exact money and enforces ownership in the query', async () => {
    if (client === undefined || repository === undefined) {
      throw new Error('Repository was not initialized.');
    }
    const account = Account.create({
      color: '#112233',
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      description: 'Synthetic account',
      icon: 'wallet',
      id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      initialBalance: Money.fromDecimal(
        '12345678901234567890.125',
        Currency.create('BHD', 3),
      ),
      institution: 'Synthetic institution',
      name: 'Synthetic account',
      ownerId: 'b36bfe2a-f319-49a8-aade-2a536ea3af38',
      type: AccountType.create('checking-account'),
    });

    await repository.insert(
      account,
      auditEvent(account, 'created', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    );

    const restored = await repository.findByIdForOwner(
      account.id,
      account.ownerId,
    );
    expect(restored?.toSnapshot()).toEqual(account.toSnapshot());
    expect(restored?.initialBalance.toDecimal()).toBe(
      '12345678901234567890.125',
    );
    await expect(
      repository.findByIdForOwner(
        account.id,
        'e89b6ad0-7838-4a2c-9a21-c775ea78e22a',
      ),
    ).resolves.toBeNull();
    await expect(
      repository.listForOwner(account.ownerId, 'active'),
    ).resolves.toHaveLength(1);
    await expect(
      repository.listForOwner(account.ownerId, 'archived'),
    ).resolves.toEqual([]);
    await expect(
      repository.listForOwner('e89b6ad0-7838-4a2c-9a21-c775ea78e22a'),
    ).resolves.toEqual([]);

    if (restored === null) throw new Error('Account was not restored.');
    restored.archive(new Date('2026-09-20T13:00:00.000Z'));
    await expect(
      repository.save(
        restored,
        1,
        auditEvent(
          restored,
          'archived',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      repository.save(
        restored,
        1,
        auditEvent(
          restored,
          'archived',
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ),
      ),
    ).resolves.toBe(false);
    await expect(client.financialAuditEvent.count()).resolves.toBe(2);
    expect(
      (
        await repository.findByIdForOwner(account.id, account.ownerId)
      )?.toSnapshot().lifecycle,
    ).toBe('archived');

    const rolledBack = Account.create({
      color: null,
      createdAt: new Date('2026-09-20T14:00:00.000Z'),
      description: null,
      icon: null,
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      initialBalance: Money.fromDecimal('0.000', Currency.create('BHD', 3)),
      institution: null,
      name: 'Rolled back account',
      ownerId: account.ownerId,
      type: AccountType.create('checking-account'),
    });
    await expect(
      repository.insert(
        rolledBack,
        auditEvent(
          rolledBack,
          'created',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ),
      ),
    ).rejects.toThrow();
    await expect(
      repository.findByIdForOwner(rolledBack.id, rolledBack.ownerId),
    ).resolves.toBeNull();
  });
});

function auditEvent(
  account: Account,
  action: 'archived' | 'created',
  id: string,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId: account.ownerId,
    id,
    occurredAt: new Date('2026-09-20T13:00:00.000Z'),
    ownerId: account.ownerId,
    resourceId: account.id,
    resourceType: 'account',
  });
}
