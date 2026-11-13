import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  Currency,
  FinancialAuditEvent,
  Money,
  Transaction,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from './prisma-transaction-repository.js';
import { PrismaTransactionTagRepository } from './prisma-transaction-tag-repository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherOwnerId = '99999999-9999-4999-8999-999999999999';
const accountId = '22222222-2222-4222-8222-222222222222';
const transactionId = '44444444-4444-4444-8444-444444444444';
const currency = Currency.create('BRL', 2);
const at = new Date('2026-09-20T12:00:00.000Z');

describe('US-029 PostgreSQL transaction write invariants', () => {
  let prisma: PrismaClient;
  let transactions: PrismaTransactionRepository;
  let connectionUri: string;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    connectionUri = container.getConnectionUri();
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });
    await client.connect();
    for (const path of [
      '../../prisma/migrations/20260920040000_create_accounts/migration.sql',
      '../../prisma/migrations/20261015120000_add_account_agency/migration.sql',
      '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
      '../../prisma/migrations/20260920180000_create_categories/migration.sql',
      '../../prisma/migrations/20260920190000_create_tags/migration.sql',
      '../../prisma/migrations/20260920200000_assign_transaction_tags/migration.sql',
      '../../prisma/migrations/20260920210000_create_cost_centers/migration.sql',
      '../../prisma/migrations/20260921010000_assign_transaction_classifications/migration.sql',
      '../../prisma/migrations/20260921110000_add_transaction_observations/migration.sql',
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
      '../../prisma/migrations/20261112120000_financial_audit_hash_chain/migration.sql',
      '../../prisma/migrations/20261005180000_create_counterparties/migration.sql',
      '../../prisma/migrations/20261021180000_counterparty_lifecycle_and_transaction_reference/migration.sql',
      '../../prisma/migrations/20261020120000_category_catalog_lifecycle/migration.sql',
      '../../prisma/migrations/20261020130000_tag_lifecycle/migration.sql',
      '../../prisma/migrations/20261021120000_cost_center_lifecycle/migration.sql',
      '../../prisma/migrations/20261103010000_transaction_idempotency/migration.sql',
      '../../prisma/migrations/20260919210000_create_user_profiles/migration.sql',
      '../../prisma/migrations/20261109120000_transaction_time_zone/migration.sql',
      '../../prisma/migrations/20261112100000_create_refund_links/migration.sql',
      '../../prisma/migrations/20261112130000_trash_elimination/migration.sql',
    ])
      await client.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    await client.end();
    prisma = createPrismaClient(container.getConnectionUri());
    transactions = new PrismaTransactionRepository(prisma);
    const account = Account.create({
      color: null,
      createdAt: at,
      description: null,
      icon: null,
      id: accountId,
      initialBalance: Money.fromDecimal('100.00', currency),
      institution: null,
      name: 'Synthetic account',
      ownerId,
      type: AccountType.create('checking-account'),
    });
    await new PrismaAccountRepository(prisma).insert(
      account,
      audit(
        'account',
        accountId,
        'created',
        '33333333-3333-4333-8333-333333333333',
      ),
    );
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await prisma.$disconnect();
    await stop?.();
  });

  it('rolls back transaction and audit together when classification is invalid', async () => {
    const invalid = transaction(
      '55555555-5555-4555-8555-555555555555',
      'income',
      '2.25',
      {
        categoryId: '66666666-6666-4666-8666-666666666666',
      },
    );
    await expect(
      transactions.insert(
        invalid,
        audit(
          'transaction',
          invalid.id,
          'created',
          '77777777-7777-4777-8777-777777777777',
        ),
      ),
    ).rejects.toThrow();
    await expect(
      transactions.findByIdForOwner(invalid.id, ownerId),
    ).resolves.toBeNull();
    await expect(
      prisma.financialAuditEvent.count({ where: { resourceId: invalid.id } }),
    ).resolves.toBe(0);
  });

  it('stores the idempotency record atomically with the transaction and audit', async () => {
    const id = '88888888-8888-4888-8888-888888888888';
    const key = 'synthetic-create-key';
    const entry = transaction(id, 'income', '1.25');
    await transactions.insert(
      entry,
      audit(
        'transaction',
        id,
        'created',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      ),
      { key, fingerprint: 'synthetic-fingerprint' },
    );
    expect(
      (await transactions.findByIdempotencyKey(ownerId, key))?.transaction.id,
    ).toBe(id);
    await expect(
      transactions.findByIdempotencyKey(otherOwnerId, key),
    ).resolves.toBeNull();
    await expect(
      transactions.insert(
        transaction('ffffffff-ffff-4fff-8fff-ffffffffffff', 'income', '2.00'),
        audit(
          'transaction',
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
          'created',
          'abababab-abab-4bab-8bab-abababababab',
        ),
        { key, fingerprint: 'different' },
      ),
    ).rejects.toThrow();
    await expect(
      transactions.findByIdForOwner(
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        ownerId,
      ),
    ).resolves.toBeNull();
    await expect(
      prisma.financialAuditEvent.count({
        where: { resourceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
      }),
    ).resolves.toBe(0);
  });

  it('rejects a stale full edit after a standalone tag replacement', async () => {
    const id = '12121212-1212-4212-8212-121212121212';
    const tagId = '13131313-1313-4313-8313-131313131313';
    const entry = transaction(id, 'expense', '3.00');
    await transactions.insert(
      entry,
      audit(
        'transaction',
        id,
        'created',
        '14141414-1414-4414-8414-141414141414',
      ),
    );
    const stale = await transactions.findByIdForOwner(id, ownerId);
    if (stale === null) throw new Error('Transaction unavailable.');
    await prisma.tag.create({
      data: { id: tagId, ownerId, name: 'Synthetic tag', updatedAt: at },
    });
    const tags = new PrismaTransactionTagRepository(prisma);
    await expect(
      tags.replaceForOwner(
        id,
        ownerId,
        [tagId],
        audit(
          'transaction',
          id,
          'updated',
          '15151515-1515-4515-8515-151515151515',
        ),
      ),
    ).resolves.toBe('updated');
    stale.updateDetails(
      {
        amount: Money.fromDecimal('4.00', currency),
        description: null,
        kind: 'expense',
        observations: null,
        occurredAt: at,
      },
      new Date('2026-09-21T12:00:00.000Z'),
    );
    await expect(
      transactions.save(
        stale,
        1,
        audit(
          'transaction',
          id,
          'updated',
          '16161616-1616-4616-8616-161616161616',
        ),
      ),
    ).resolves.toBe(false);
    expect(
      (await transactions.findByIdForOwner(id, ownerId))?.toSnapshot().tagIds,
    ).toEqual([tagId]);
    await expect(
      prisma.financialAuditEvent.count({ where: { resourceId: id } }),
    ).resolves.toBe(2);
  });

  it('rejects a new classification when its category archives during the write', async () => {
    const categoryId = '17171717-1717-4717-8717-171717171717';
    const id = '18181818-1818-4818-8818-181818181818';
    await prisma.category.create({
      data: {
        id: categoryId,
        ownerId,
        name: 'Synthetic category',
        updatedAt: at,
      },
    });
    const lock = new Client({ connectionString: connectionUri });
    await lock.connect();
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT id FROM categories WHERE id = $1 FOR UPDATE', [
        categoryId,
      ]);
      const insert = transactions.insert(
        transaction(id, 'expense', '5.00', { categoryId }),
        audit(
          'transaction',
          id,
          'created',
          '19191919-1919-4919-8919-191919191919',
        ),
      );
      await lock.query('UPDATE categories SET archived_at = $1 WHERE id = $2', [
        at,
        categoryId,
      ]);
      await lock.query('COMMIT');
      await expect(insert).rejects.toThrow();
      await expect(
        transactions.findByIdForOwner(id, ownerId),
      ).resolves.toBeNull();
      await expect(
        prisma.financialAuditEvent.count({ where: { resourceId: id } }),
      ).resolves.toBe(0);
    } finally {
      await lock.query('ROLLBACK');
      await lock.end();
    }
  });

  it('preserves historical classification but rejects a new subcategory under an archived parent', async () => {
    const categoryId = '20202020-2020-4020-8020-202020202020';
    const oldSubcategoryId = '21212121-2121-4121-8121-212121212121';
    const newSubcategoryId = '22222222-2222-4222-8222-222222222223';
    const id = '23232323-2323-4323-8323-232323232323';
    await prisma.category.create({
      data: {
        id: categoryId,
        ownerId,
        name: 'Historical parent',
        updatedAt: at,
      },
    });
    for (const [subcategoryId, name] of [
      [oldSubcategoryId, 'Historical child'],
      [newSubcategoryId, 'New child'],
    ] as const) {
      await prisma.category.create({
        data: {
          id: subcategoryId,
          ownerId,
          parentCategoryId: categoryId,
          name,
          updatedAt: at,
        },
      });
    }
    const entry = Transaction.create({
      accountId,
      amount: Money.fromDecimal('5.00', currency),
      categoryId,
      subcategoryId: oldSubcategoryId,
      createdAt: at,
      description: null,
      id,
      kind: 'expense',
      occurredAt: at,
      ownerId,
    });
    await transactions.insert(
      entry,
      audit(
        'transaction',
        id,
        'created',
        '24242424-2424-4424-8424-242424242424',
      ),
    );
    await prisma.category.update({
      data: { archivedAt: at },
      where: { id: categoryId },
    });

    entry.updateDetails(
      {
        amount: entry.amount,
        description: 'Historical edit',
        kind: 'expense',
        occurredAt: at,
      },
      new Date('2026-09-21T12:00:00.000Z'),
    );
    await expect(
      transactions.save(
        entry,
        1,
        audit(
          'transaction',
          id,
          'updated',
          '25252525-2525-4525-8525-252525252525',
        ),
      ),
    ).resolves.toBe(true);

    entry.updateDetails(
      {
        amount: entry.amount,
        description: 'Rejected edit',
        kind: 'expense',
        occurredAt: at,
        subcategoryId: newSubcategoryId,
      },
      new Date('2026-09-22T12:00:00.000Z'),
    );
    await expect(
      transactions.save(
        entry,
        2,
        audit(
          'transaction',
          id,
          'updated',
          '26262626-2626-4626-8626-262626262626',
        ),
      ),
    ).rejects.toThrow('Category unavailable.');
    const persisted = await transactions.findByIdForOwner(id, ownerId);
    expect(persisted?.toSnapshot()).toMatchObject({
      categoryId,
      description: 'Historical edit',
      subcategoryId: oldSubcategoryId,
      version: 2,
    });
    await expect(
      prisma.financialAuditEvent.count({ where: { resourceId: id } }),
    ).resolves.toBe(2);
  });

  it('preserves exact balance deltas, owner isolation, archived history and minimal audit payload', async () => {
    const startingBalance = Money.fromDecimal(await balance(), currency);
    const entry = transaction(transactionId, 'income', '10.25');
    await transactions.insert(
      entry,
      audit(
        'transaction',
        transactionId,
        'created',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    );
    await expect(
      transactions.findByIdForOwner(transactionId, otherOwnerId),
    ).resolves.toBeNull();
    expect(await balance()).toBe(
      startingBalance.add(Money.fromDecimal('10.25', currency)).toDecimal(),
    );

    entry.updateDetails(
      {
        amount: Money.fromDecimal('7.50', currency),
        description: 'Private synthetic description',
        kind: 'expense',
        observations: 'Private synthetic observation',
        occurredAt: at,
      },
      new Date('2026-09-21T12:00:00.000Z'),
    );
    await expect(
      transactions.save(
        entry,
        1,
        audit(
          'transaction',
          transactionId,
          'updated',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        ),
      ),
    ).resolves.toBe(true);
    expect(await balance()).toBe(
      startingBalance.subtract(Money.fromDecimal('7.50', currency)).toDecimal(),
    );
    const revisions = await transactions.listRevisionsForOwner(
      transactionId,
      ownerId,
    );
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ previousVersion: 1, newVersion: 2 });
    expect(JSON.stringify(revisions[0])).toContain('10.25');
    expect(JSON.stringify(revisions[0])).toContain('7.50');
    await expect(
      transactions.listRevisionsForOwner(transactionId, otherOwnerId),
    ).resolves.toEqual([]);
    await expect(
      transactions.save(
        entry,
        1,
        audit(
          'transaction',
          transactionId,
          'updated',
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ),
      ),
    ).resolves.toBe(false);
    await expect(
      prisma.financialAuditEvent.count({
        where: { resourceId: transactionId },
      }),
    ).resolves.toBe(2);
    await expect(
      transactions.listRevisionsForOwner(transactionId, ownerId),
    ).resolves.toHaveLength(1);

    const version = entry.toSnapshot().version;
    entry.archive(new Date('2026-09-22T12:00:00.000Z'));
    await expect(
      transactions.save(
        entry,
        version,
        audit(
          'transaction',
          transactionId,
          'archived',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        ),
      ),
    ).resolves.toBe(true);
    expect(await balance()).toBe(
      startingBalance.subtract(Money.fromDecimal('7.50', currency)).toDecimal(),
    );
    expect(
      (await transactions.findByIdForOwner(transactionId, ownerId))?.lifecycle,
    ).toBe('archived');
    const events = await prisma.financialAuditEvent.findMany({
      where: { resourceId: transactionId },
    });
    expect(events.map(({ action }) => action).sort()).toEqual([
      'archived',
      'created',
      'updated',
    ]);
    for (const event of events) {
      const serialized = JSON.stringify(event, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialized).not.toContain('Private synthetic');
      expect(serialized).not.toContain('7.50');
    }
  });

  async function balance(): Promise<string> {
    const effects = await transactions.sumBalanceEffectsForAccountOwner(
      accountId,
      ownerId,
    );
    return effects
      .reduce(
        (sum, effect) => sum.add(effect),
        Money.fromDecimal('0', currency),
      )
      .toDecimal();
  }
});

function transaction(
  id: string,
  kind: 'income' | 'expense',
  amount: string,
  extras: { categoryId?: string } = {},
): Transaction {
  return Transaction.create({
    accountId,
    amount: Money.fromDecimal(amount, currency),
    createdAt: at,
    description: null,
    id,
    kind,
    occurredAt: at,
    ownerId,
    ...extras,
  });
}

function audit(
  resourceType: 'account' | 'transaction',
  resourceId: string,
  action: 'created' | 'updated' | 'archived',
  id: string,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId: ownerId,
    id,
    occurredAt: at,
    ownerId,
    resourceId,
    resourceType,
  });
}
