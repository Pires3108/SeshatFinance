import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  CardPurchase,
  Currency,
  FinancialAuditEvent,
  Money,
} from '@seshat/domain';
import { CardPurchaseIdempotencyConflictError } from '@seshat/application';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaCardPurchaseRepository } from './prisma-card-purchase-repository.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const accountId = '11111111-1111-4111-8111-111111111111';
const cardId = '22222222-2222-4222-8222-222222222222';
const at = new Date('2026-10-05T12:00:00.000Z');

function purchase(id: string, amount = '10.00'): CardPurchase {
  return CardPurchase.create({
    amount: Money.fromDecimal(amount, Currency.create('BRL', 2)),
    cardId,
    createdAt: at,
    description: 'Synthetic purchase',
    id,
    occurredAt: at,
    ownerId,
  });
}
function audit(id: string): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: ownerId,
    id: crypto.randomUUID(),
    occurredAt: at,
    ownerId,
    resourceId: id,
    resourceType: 'card-purchase',
  });
}

describe('PrismaCardPurchaseRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let client: PrismaClient;
  let repository: PrismaCardPurchaseRepository;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const pg = new Client({ connectionString: container.getConnectionUri() });
    await pg.connect();
    for (const path of [
      '../../prisma/migrations/20260920040000_create_accounts/migration.sql',
      '../../prisma/migrations/20260920133000_create_transactions/migration.sql',
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
      '../../prisma/migrations/20260922183000_add_credit_card_audit_resource/migration.sql',
      '../../prisma/migrations/20260922190000_create_credit_cards/migration.sql',
      '../../prisma/migrations/20261005120000_create_card_purchases/migration.sql',
    ])
      await pg.query(await readFile(new URL(path, import.meta.url), 'utf8'));
    await pg.query(
      `INSERT INTO accounts (id, owner_id, name, type_key, initial_balance_minor_units,
      currency_code, currency_minor_unit_scale, lifecycle, created_at, updated_at, version)
      VALUES ($1, $2, 'Synthetic', 'checking', 10000, 'BRL', 2, 'active', $3, $3, 1)`,
      [accountId, ownerId, at],
    );
    await pg.query(
      `INSERT INTO credit_cards (id, owner_id, payment_account_id, name, brand,
      limit_minor_units, currency_code, currency_minor_unit_scale, closing_day, due_day, created_at)
      VALUES ($1, $2, $3, 'Synthetic', 'Visa', 50000, 'BRL', 2, 28, 7, $4)`,
      [cardId, ownerId, accountId, at],
    );
    await pg.end();
    client = createPrismaClient(container.getConnectionUri());
    repository = new PrismaCardPurchaseRepository(client);
    disconnect = async (): Promise<void> => client.$disconnect();
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('writes one purchase and one audit event, while preserving account balance', async () => {
    const value = purchase(crypto.randomUUID());
    const first = await repository.register(
      value,
      'key-1',
      'a'.repeat(64),
      audit(value.id),
    );
    const retry = await repository.register(
      purchase(crypto.randomUUID()),
      'key-1',
      'a'.repeat(64),
      audit(crypto.randomUUID()),
    );
    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.purchase.id).toBe(value.id);
    expect(await client.cardPurchase.count()).toBe(1);
    expect(
      await client.financialAuditEvent.count({
        where: { resourceType: 'card_purchase' },
      }),
    ).toBe(1);
    expect(
      (
        await client.account.findUniqueOrThrow({ where: { id: accountId } })
      ).initialBalanceMinorUnits.toFixed(0),
    ).toBe('10000');
    expect(await client.transaction.count()).toBe(0);
  });

  it('rejects conflicting payload without another financial effect', async () => {
    await expect(
      repository.register(
        purchase(crypto.randomUUID(), '20.00'),
        'key-1',
        'b'.repeat(64),
        audit(crypto.randomUUID()),
      ),
    ).rejects.toBeInstanceOf(CardPurchaseIdempotencyConflictError);
    expect(await client.cardPurchase.count()).toBe(1);
  });

  it('collapses concurrent identical requests to one purchase', async () => {
    const attempts = Array.from({ length: 4 }, () => {
      const value = purchase(crypto.randomUUID());
      return repository.register(
        value,
        'key-concurrent',
        'c'.repeat(64),
        audit(value.id),
      );
    });
    const results = await Promise.all(attempts);
    expect(new Set(results.map((result) => result.purchase.id)).size).toBe(1);
    expect(
      await client.cardPurchase.count({
        where: { idempotencyKey: 'key-concurrent' },
      }),
    ).toBe(1);
  });

  it('rolls back a purchase if its audit event cannot be persisted', async () => {
    const id = crypto.randomUUID();
    const event = audit(id).toSnapshot();
    const duplicateAudit = FinancialAuditEvent.create(event);
    await client.financialAuditEvent.create({
      data: { ...event, resourceType: 'card_purchase' },
    });
    await expect(
      repository.register(
        purchase(id),
        'key-rollback',
        'd'.repeat(64),
        duplicateAudit,
      ),
    ).rejects.toThrow();
    expect(await client.cardPurchase.findUnique({ where: { id } })).toBeNull();
    expect(
      await client.cardPurchase.count({
        where: { idempotencyKey: 'key-rollback' },
      }),
    ).toBe(0);
  });

  it('enforces card ownership in persistence before creating financial effects', async () => {
    const id = crypto.randomUUID();
    const foreignPurchase = CardPurchase.create({
      ...purchase(id).toSnapshot(),
      amount: Money.fromDecimal('10.00', Currency.create('BRL', 2)),
      ownerId: crypto.randomUUID(),
    });
    await expect(
      repository.register(
        foreignPurchase,
        'key-foreign-owner',
        'e'.repeat(64),
        audit(id),
      ),
    ).rejects.toThrow();
    expect(await client.cardPurchase.findUnique({ where: { id } })).toBeNull();
    expect(
      await client.financialAuditEvent.count({ where: { resourceId: id } }),
    ).toBe(0);
  });
});
