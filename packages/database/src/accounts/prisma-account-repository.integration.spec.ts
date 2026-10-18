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
      '../../prisma/migrations/20261015120000_add_account_agency/migration.sql',
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

  it('persists and restores BRL 0.10 plus 0.20 as exactly 0.30', async () => {
    if (client === undefined || repository === undefined) {
      throw new Error('Repository was not initialized.');
    }
    const brl = Currency.create('BRL', 2);
    const balance = Money.fromDecimal('0.10', brl).add(
      Money.fromDecimal('0.20', brl),
    );
    const account = Account.create({
      color: null,
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      description: null,
      icon: null,
      id: '09ee511c-0768-4546-b832-a2d19e233fa1',
      initialBalance: balance,
      institution: null,
      name: 'Exact BRL account',
      ownerId: '34c25d03-61d5-434d-b583-cb0ef1b296e5',
      type: AccountType.create('checking-account'),
    });

    await repository.insert(
      account,
      auditEvent(account, 'created', '33ae528a-35cf-46c5-ac66-1ce8fc5afc8f'),
    );

    const restored = await repository.findByIdForOwner(
      account.id,
      account.ownerId,
    );
    expect(restored?.initialBalance.toDecimal()).toBe('0.30');
    expect(restored?.initialBalance.currency.toSnapshot()).toEqual({
      code: 'BRL',
      minorUnitScale: 2,
    });
    const persisted = await client.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(persisted.initialBalanceMinorUnits.toFixed(0)).toBe('30');
  });

  it('round-trips exact money and enforces ownership in the query', async () => {
    if (client === undefined || repository === undefined) {
      throw new Error('Repository was not initialized.');
    }
    const account = Account.create({
      agency: '0123',
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
    expect(restored?.toSnapshot().agency).toBe('0123');
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
    await expect(
      repository.listForOwnedBalanceSummary(account.ownerId),
    ).resolves.toHaveLength(1);
    await expect(
      repository.listForOwnedBalanceSummary(
        'e89b6ad0-7838-4a2c-9a21-c775ea78e22a',
      ),
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
    await expect(
      client.financialAuditEvent.count({
        where: { ownerId: account.ownerId, resourceId: account.id },
      }),
    ).resolves.toBe(2);
    const archived = await repository.findByIdForOwner(
      account.id,
      account.ownerId,
    );
    if (archived === null)
      throw new Error('Archived account was not restored.');
    const archivedAt = archived.toSnapshot().archivedAt;
    expect(archivedAt).toEqual(new Date('2026-09-20T13:00:00.000Z'));
    await expect(
      repository.listForOwnedBalanceSummary(account.ownerId),
    ).resolves.toHaveLength(1);

    archived.moveToTrash(new Date('2026-09-20T14:00:00.000Z'));
    await expect(
      repository.save(
        archived,
        2,
        auditEvent(
          archived,
          'moved-to-trash',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        ),
      ),
    ).resolves.toBe(true);
    const trashed = await repository.findByIdForOwner(
      account.id,
      account.ownerId,
    );
    if (trashed === null) throw new Error('Trashed account was not restored.');
    await expect(
      repository.listForOwnedBalanceSummary(account.ownerId),
    ).resolves.toEqual([]);
    trashed.restoreFromTrash(new Date('2026-09-20T15:00:00.000Z'));
    await expect(
      repository.save(
        trashed,
        3,
        auditEvent(
          trashed,
          'restored-from-trash',
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        ),
      ),
    ).resolves.toBe(true);
    const restoredAfterTrash = await repository.findByIdForOwner(
      account.id,
      account.ownerId,
    );
    expect(restoredAfterTrash?.toSnapshot()).toMatchObject({
      agency: '0123',
      archivedAt,
      lifecycle: 'archived',
      trashedAt: null,
      version: 4,
    });
    await expect(
      repository.listForOwner(account.ownerId, 'archived'),
    ).resolves.toHaveLength(1);
    await expect(
      repository.listForOwner(account.ownerId, 'trashed'),
    ).resolves.toEqual([]);
    await expect(
      repository.listForOwnedBalanceSummary(account.ownerId),
    ).resolves.toHaveLength(1);
    await expect(
      client.financialAuditEvent.count({
        where: {
          action: 'restored_from_trash',
          ownerId: account.ownerId,
          resourceId: account.id,
        },
      }),
    ).resolves.toBe(1);
    if (restoredAfterTrash === null)
      throw new Error('Account was not restored.');
    restoredAfterTrash.updateDetails(
      {
        agency: null,
        color: restoredAfterTrash.toSnapshot().color,
        description: restoredAfterTrash.toSnapshot().description,
        icon: restoredAfterTrash.toSnapshot().icon,
        institution: restoredAfterTrash.toSnapshot().institution,
        name: restoredAfterTrash.toSnapshot().name,
        type: AccountType.create('checking-account'),
      },
      new Date('2026-09-20T16:00:00.000Z'),
    );
    await expect(
      repository.save(
        restoredAfterTrash,
        4,
        auditEvent(
          restoredAfterTrash,
          'updated',
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
        ),
      ),
    ).resolves.toBe(true);
    expect(
      (
        await repository.findByIdForOwner(account.id, account.ownerId)
      )?.toSnapshot().agency,
    ).toBeNull();

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
  action:
    | 'archived'
    | 'created'
    | 'moved-to-trash'
    | 'restored-from-trash'
    | 'updated',
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
