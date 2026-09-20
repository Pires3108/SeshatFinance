import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Account, AccountType, Currency, Money } from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaAccountRepository } from './prisma-account-repository.js';

describe('PrismaAccountRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let repository: PrismaAccountRepository | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20260920040000_create_accounts/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const migrationClient = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migrationClient.connect();
    await migrationClient.query(migration);
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaAccountRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('round-trips exact money and enforces ownership in the query', async () => {
    if (repository === undefined) {
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

    await repository.insert(account);

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

    if (restored === null) throw new Error('Account was not restored.');
    restored.archive(new Date('2026-09-20T13:00:00.000Z'));
    await expect(repository.save(restored, 1)).resolves.toBe(true);
    await expect(repository.save(restored, 1)).resolves.toBe(false);
    expect(
      (
        await repository.findByIdForOwner(account.id, account.ownerId)
      )?.toSnapshot().lifecycle,
    ).toBe('archived');
  });
});
