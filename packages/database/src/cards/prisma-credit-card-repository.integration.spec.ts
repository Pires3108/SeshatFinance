import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  CreditCard,
  Currency,
  FinancialAuditEvent,
  Money,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaCreditCardRepository } from './prisma-credit-card-repository.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const accountId = '11111111-1111-4111-8111-111111111111';

describe('PrismaCreditCardRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let repository: PrismaCreditCardRepository | undefined;

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
      '../../prisma/migrations/20260921210000_create_financial_audit_events/migration.sql',
      '../../prisma/migrations/20260922183000_add_credit_card_audit_resource/migration.sql',
      '../../prisma/migrations/20260922190000_create_credit_cards/migration.sql',
    ]) {
      await migrationClient.query(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      );
    }
    await migrationClient.end();
    const prisma = createPrismaClient(container.getConnectionUri());
    client = prisma;
    disconnect = async (): Promise<void> => prisma.$disconnect();
    repository = new PrismaCreditCardRepository(prisma);
    const value = account();
    await new PrismaAccountRepository(prisma).insert(
      value,
      auditEvent(value.id, 'account', crypto.randomUUID()),
    );
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('persists exact configuration and audit metadata atomically', async () => {
    if (client === undefined || repository === undefined) throw unavailable();
    const card = creditCard('22222222-2222-4222-8222-222222222222');

    await repository.insert(
      card,
      auditEvent(
        card.id,
        'credit-card',
        '33333333-3333-4333-8333-333333333333',
      ),
    );

    await expect(
      client.creditCard.findUniqueOrThrow({ where: { id: card.id } }),
    ).resolves.toMatchObject({
      brand: 'Visa',
      closingDay: 28,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      dueDay: 7,
      ownerId,
      paymentAccountId: accountId,
    });
    expect(
      (
        await client.creditCard.findUniqueOrThrow({ where: { id: card.id } })
      ).limitMinorUnits.toFixed(0),
    ).toBe('350000');
    await expect(
      client.financialAuditEvent.count({
        where: { resourceId: card.id, resourceType: 'credit_card' },
      }),
    ).resolves.toBe(1);
  });

  it('rolls the card back when its audit event cannot be inserted', async () => {
    if (client === undefined || repository === undefined) throw unavailable();
    const card = creditCard('44444444-4444-4444-8444-444444444444');

    await expect(
      repository.insert(
        card,
        auditEvent(
          card.id,
          'credit-card',
          '33333333-3333-4333-8333-333333333333',
        ),
      ),
    ).rejects.toThrow();
    await expect(
      client.creditCard.findUnique({ where: { id: card.id } }),
    ).resolves.toBeNull();
  });

  it('restores exact values and isolates reads by owner', async () => {
    if (repository === undefined) throw unavailable();
    const id = '22222222-2222-4222-8222-222222222222';
    const found = await repository.findByIdForOwner(id, ownerId);
    expect(found?.limit.toDecimal()).toBe('3500.00');
    expect(found?.paymentAccountId).toBe(accountId);
    await expect(
      repository.findByIdForOwner(id, '88888888-8888-4888-8888-888888888888'),
    ).resolves.toBeNull();
    expect(
      (await repository.listForOwner(ownerId)).map((card) => card.id),
    ).toContain(id);
    await expect(
      repository.listForOwner('88888888-8888-4888-8888-888888888888'),
    ).resolves.toEqual([]);
  });
});

function account(): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-22T17:00:00.000Z'),
    description: null,
    icon: null,
    id: accountId,
    initialBalance: Money.fromDecimal('0.00', Currency.create('BRL', 2)),
    institution: null,
    name: 'Conta de pagamento',
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

function creditCard(id: string): CreditCard {
  return CreditCard.create({
    brand: 'Visa',
    closingDay: 28,
    createdAt: new Date('2026-09-22T18:00:00.000Z'),
    dueDay: 7,
    id,
    limit: Money.fromDecimal('3500.00', Currency.create('BRL', 2)),
    name: 'Cartão principal',
    ownerId,
    paymentAccountId: accountId,
  });
}

function auditEvent(
  resourceId: string,
  resourceType: 'account' | 'credit-card',
  id: string,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: ownerId,
    id,
    occurredAt: new Date('2026-09-22T18:00:00.000Z'),
    ownerId,
    resourceId,
    resourceType,
  });
}

function unavailable(): Error {
  return new Error('Credit card persistence is unavailable.');
}
