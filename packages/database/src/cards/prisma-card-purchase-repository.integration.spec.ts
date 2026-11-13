import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  IdempotencyConflictError,
  type IdempotencyRequest,
} from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  CardPurchase,
  CivilDate,
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
import { PrismaCardPurchaseRepository } from './prisma-card-purchase-repository.js';
import { PrismaCreditCardRepository } from './prisma-credit-card-repository.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const otherId = '88888888-8888-4888-8888-888888888888';
const accountId = '11111111-1111-4111-8111-111111111111';
const cardId = '22222222-2222-4222-8222-222222222222';
const brl = Currency.create('BRL', 2);

describe('PrismaCardPurchaseRepository', () => {
  let stop: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let repository: PrismaCardPurchaseRepository | undefined;

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
    const migrations = new URL('../../prisma/migrations/', import.meta.url);
    for (const directory of (await readdir(migrations)).sort()) {
      if (!/^\d/u.test(directory)) continue;
      await migrationClient.query(
        await readFile(
          new URL(`${directory}/migration.sql`, migrations),
          'utf8',
        ),
      );
    }
    await migrationClient.end();
    client = createPrismaClient(container.getConnectionUri());
    repository = new PrismaCardPurchaseRepository(client);
    const account = Account.create({
      color: null,
      createdAt: new Date('2026-09-22T17:00:00.000Z'),
      description: null,
      icon: null,
      id: accountId,
      initialBalance: Money.fromDecimal('1000.00', brl),
      institution: null,
      name: 'Conta pagadora',
      ownerId,
      type: AccountType.create('checking-account'),
    });
    await new PrismaAccountRepository(client).insert(
      account,
      audit(accountId, 'account'),
    );
    await new PrismaCreditCardRepository(client).insert(
      CreditCard.create({
        brand: 'Visa',
        closingDay: 28,
        createdAt: new Date('2026-09-22T18:00:00.000Z'),
        dueDay: 7,
        id: cardId,
        limit: Money.fromDecimal('3500.00', brl),
        name: 'Cartão',
        ownerId,
        paymentAccountId: accountId,
      }),
      audit(cardId, 'credit-card'),
    );
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await client?.$disconnect();
    await stop?.();
  });

  it('records the purchase and audit once, without touching the paying account', async () => {
    if (client === undefined || repository === undefined) throw unavailable();
    const item = purchase('120.35');
    const request = idempotency(randomUUID(), '120.35');

    await repository.insertAtomically(item, audit(item.id, 'card-purchase'), {
      request,
      response: 'stored',
    });

    const stored = await repository.listForCard(cardId, ownerId, '2026-10-28');
    expect(stored.map((value) => value.toSnapshot())).toEqual([
      item.toSnapshot(),
    ]);
    await expect(
      client.financialAuditEvent.count({ where: { resourceId: item.id } }),
    ).resolves.toBe(1);
    await expect(
      client.transaction.count({ where: { accountId } }),
    ).resolves.toBe(0);
  });

  it('replays an identical key and rejects a different payload without writing', async () => {
    if (client === undefined || repository === undefined) throw unavailable();
    const key = randomUUID();
    const first = purchase('10.00');
    await repository.insertAtomically(first, audit(first.id, 'card-purchase'), {
      request: idempotency(key, '10.00'),
      response: 'first',
    });
    const before = await client.cardPurchase.count();

    const retry = purchase('10.00');
    await expect(
      repository.insertAtomically(retry, audit(retry.id, 'card-purchase'), {
        request: idempotency(key, '10.00'),
        response: 'second',
      }),
    ).resolves.toBe('first');
    const different = purchase('11.00');
    await expect(
      repository.insertAtomically(
        different,
        audit(different.id, 'card-purchase'),
        { request: idempotency(key, '11.00'), response: 'third' },
      ),
    ).rejects.toThrow(IdempotencyConflictError);
    await expect(client.cardPurchase.count()).resolves.toBe(before);
  });

  it('writes at most one purchase for concurrent requests with the same key', async () => {
    if (client === undefined || repository === undefined) throw unavailable();
    const key = randomUUID();
    const before = await client.cardPurchase.count();
    const target = repository;

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => {
        const item = purchase('5.00');
        return target.insertAtomically(item, audit(item.id, 'card-purchase'), {
          request: idempotency(key, '5.00'),
          response: 'concurrent',
        });
      }),
    );

    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(IdempotencyConflictError);
      }
    }
    await expect(client.cardPurchase.count()).resolves.toBe(before + 1);
  });

  it('isolates purchases by owner and rejects a foreign card at the database', async () => {
    if (client === undefined || repository === undefined) throw unavailable();
    await expect(repository.listForCard(cardId, otherId)).resolves.toEqual([]);
    const foreign = CardPurchase.create({
      amount: Money.fromDecimal('1.00', brl),
      cardId,
      createdAt: new Date(),
      cycleClosesOn: CivilDate.parse('2026-10-28'),
      description: 'Intrusa',
      id: randomUUID(),
      occurredAt: new Date('2026-10-20T12:00:00.000Z'),
      ownerId: otherId,
    });
    await expect(
      repository.insertAtomically(
        foreign,
        audit(foreign.id, 'card-purchase', otherId),
        {
          request: { ...idempotency(randomUUID(), '1.00'), ownerId: otherId },
          response: 'x',
        },
      ),
    ).rejects.toThrow();
  });
});

function purchase(amount: string): CardPurchase {
  return CardPurchase.create({
    amount: Money.fromDecimal(amount, brl),
    cardId,
    createdAt: new Date('2026-10-20T15:00:00.000Z'),
    cycleClosesOn: CivilDate.parse('2026-10-28'),
    description: 'Mercado',
    id: randomUUID(),
    occurredAt: new Date('2026-10-20T14:00:00.000Z'),
    ownerId,
  });
}

function idempotency(key: string, amount: string): IdempotencyRequest {
  return {
    key,
    operation: 'card-purchase.create',
    ownerId,
    payload: { amount, cardId },
    requestedAt: new Date('2026-10-20T15:00:00.000Z'),
  };
}

function audit(
  resourceId: string,
  resourceType: 'account' | 'credit-card' | 'card-purchase',
  actor = ownerId,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: actor,
    id: randomUUID(),
    occurredAt: new Date('2026-10-20T15:00:00.000Z'),
    ownerId: actor,
    resourceId,
    resourceType,
  });
}

function unavailable(): Error {
  return new Error('Card purchase persistence is unavailable.');
}
