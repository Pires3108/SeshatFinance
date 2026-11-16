import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  CardCycleResolver,
  CardInstallmentInvoiceClosedError,
  CardInstallmentSettledAboveObligationError,
  CardPurchaseAlreadyInstalledError,
  CloseCardInvoiceUseCase,
  DeclareInvoiceSettlementUseCase,
  EMPTY_HOLIDAY_SETTINGS,
  IdempotencyConflictError,
  InvoiceDueStateResolver,
  RegisterCardInstallmentPlanUseCase,
  RegisterCardPurchaseUseCase,
} from '@seshat/application';
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
import { PrismaCardInstallmentPlanRepository } from './prisma-card-installment-plan-repository.js';
import { PrismaCardInvoiceRepository } from './prisma-card-invoice-repository.js';
import { PrismaCardPurchaseRepository } from './prisma-card-purchase-repository.js';
import { PrismaCreditCardRepository } from './prisma-credit-card-repository.js';
import { PrismaInvoiceSettlementRepository } from './prisma-invoice-settlement-repository.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const accountId = '11111111-1111-4111-8111-111111111111';
const cardId = '22222222-2222-4222-8222-222222222222';
const brl = Currency.create('BRL', 2);
const now = new Date('2026-11-16T12:00:00.000Z');

const resolver = new CardCycleResolver(
  {
    changeTimeZone: () => Promise.resolve(null),
    findById: () => Promise.resolve(null),
    upsert: (profile) => Promise.resolve(profile),
  },
  {
    addDeclared: () => Promise.resolve(),
    findForOwner: () => Promise.resolve(EMPTY_HOLIDAY_SETTINGS),
    removeDeclared: () => Promise.resolve(false),
    saveLocation: () => Promise.resolve(),
  },
);
const clock = { now: (): Date => now };
const identifiers = { generate: (): string => randomUUID() };

describe('card installment plans in PostgreSQL (US-044, INV-005, INV-017, INV-019)', () => {
  let stop: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;

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
    await new PrismaAccountRepository(client).insert(
      Account.create({
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
      }),
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

  function db(): PrismaClient {
    if (client === undefined) throw new Error('PostgreSQL unavailable.');
    return client;
  }

  const cards = (): PrismaCreditCardRepository =>
    new PrismaCreditCardRepository(db());
  const plans = (): PrismaCardInstallmentPlanRepository =>
    new PrismaCardInstallmentPlanRepository(db());
  const invoices = (): PrismaCardInvoiceRepository =>
    new PrismaCardInvoiceRepository(db());

  async function purchase(amount: string, occurredAt: string): Promise<string> {
    const created = await new RegisterCardPurchaseUseCase(
      cards(),
      new PrismaCardPurchaseRepository(db()),
      { findByIdForOwner: () => Promise.resolve(null) },
      resolver,
      clock,
      identifiers,
    ).execute({
      actorId: ownerId,
      amount,
      cardId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: 'Compra',
      idempotencyKey: randomUUID(),
      occurredAt: new Date(occurredAt),
    });
    return created.id;
  }

  const install = (
    purchaseId: string,
    count: number,
    key = randomUUID(),
    rate: {
      method: string;
      percentPerPeriod: string;
      periodicity: string;
    } | null = null,
  ): ReturnType<RegisterCardInstallmentPlanUseCase['execute']> =>
    new RegisterCardInstallmentPlanUseCase(
      cards(),
      plans(),
      resolver,
      clock,
      identifiers,
    ).execute({
      actorId: ownerId,
      cardId,
      count,
      idempotencyKey: key,
      purchaseId,
      rate,
    });

  async function charges(closesOn: string): Promise<string | undefined> {
    return (
      await invoices().findForCard(cardId, closesOn, ownerId)
    )?.purchasesTotal.toDecimal();
  }

  it('moves the obligation to one installment per cycle and keeps the plan reproducible', async () => {
    await purchase('50.00', '2027-01-05T12:00:00.000Z');
    const purchaseId = await purchase('100.00', '2027-01-10T12:00:00.000Z');
    expect(await charges('2027-01-28')).toBe('150.00');

    const plan = await install(purchaseId, 3);

    expect(await charges('2027-01-28')).toBe('83.33');
    expect(await charges('2027-02-28')).toBe('33.33');
    expect(await charges('2027-03-28')).toBe('33.34');
    const stored = await plans().findPlanForPurchase(purchaseId, ownerId);
    expect(stored?.toSnapshot()).toEqual(plan.toSnapshot());
    await expect(
      db().financialAuditEvent.count({
        where: { resourceId: plan.id, resourceType: 'card_installment_plan' },
      }),
    ).resolves.toBe(1);
  });

  it('stores compound interest exactly and closes every sum (INV-019)', async () => {
    const purchaseId = await purchase('100.00', '2027-04-10T12:00:00.000Z');
    const plan = await install(purchaseId, 2, randomUUID(), {
      method: 'compound',
      percentPerPeriod: '1',
      periodicity: 'monthly',
    });

    expect(plan.total.toDecimal()).toBe('102.01');
    const [sums] = await db().$queryRaw<
      { amount: string; principal: string; interest: string }[]
    >`
      SELECT SUM("amount_minor_units")::text AS "amount",
             SUM("principal_minor_units")::text AS "principal",
             SUM("interest_minor_units")::text AS "interest"
      FROM "card_installments" WHERE "plan_id" = ${plan.id}::uuid
    `;
    expect(sums).toEqual({
      amount: '10201',
      interest: '201',
      principal: '10000',
    });
  });

  it('replays the same confirmation without new installments and rejects a changed one', async () => {
    const purchaseId = await purchase('90.00', '2027-06-10T12:00:00.000Z');
    const key = randomUUID();
    const first = await install(purchaseId, 3, key);
    const before = await db().cardInstallment.count();

    expect((await install(purchaseId, 3, key)).toSnapshot()).toEqual(
      first.toSnapshot(),
    );
    await expect(install(purchaseId, 2, key)).rejects.toThrow(
      IdempotencyConflictError,
    );
    await expect(db().cardInstallment.count()).resolves.toBe(before);
  });

  it('creates a single plan under concurrent confirmations with different keys', async () => {
    const purchaseId = await purchase('60.00', '2027-08-10T12:00:00.000Z');
    const results = await Promise.allSettled([
      install(purchaseId, 2),
      install(purchaseId, 3),
      install(purchaseId, 4),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(CardPurchaseAlreadyInstalledError);
      }
    }
    await expect(
      db().cardInstallmentPlan.count({ where: { purchaseId } }),
    ).resolves.toBe(1);
  });

  it('rejects when the purchase invoice is closed, without writing', async () => {
    const purchaseId = await purchase('40.00', '2027-10-10T12:00:00.000Z');
    await new CloseCardInvoiceUseCase(
      cards(),
      invoices(),
      clock,
      identifiers,
      new InvoiceDueStateResolver(
        {
          changeTimeZone: () => Promise.resolve(null),
          findById: () => Promise.resolve(null),
          upsert: (profile) => Promise.resolve(profile),
        },
        clock,
      ),
    ).execute({ actorId: ownerId, cardId, closesOn: '2027-10-28' });

    await expect(install(purchaseId, 2)).rejects.toThrow(
      CardInstallmentInvoiceClosedError,
    );
    await expect(
      db().cardInstallmentPlan.count({ where: { purchaseId } }),
    ).resolves.toBe(0);
    expect(await charges('2027-10-28')).toBe('40.00');
  });

  it('rejects when declared settlements exceed the new obligation (INV-018)', async () => {
    const purchaseId = await purchase('100.00', '2027-12-10T12:00:00.000Z');
    await new DeclareInvoiceSettlementUseCase(
      cards(),
      new PrismaAccountRepository(db()),
      new PrismaInvoiceSettlementRepository(db()),
      clock,
      identifiers,
    ).execute({
      accountId,
      actorId: ownerId,
      amount: '60.00',
      cardId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      idempotencyKey: randomUUID(),
      invoiceClosesOn: '2027-12-28',
      paidAt: now,
    });

    await expect(install(purchaseId, 2)).rejects.toThrow(
      CardInstallmentSettledAboveObligationError,
    );
    await expect(
      db().cardInstallment.count({
        where: { cycleClosesOn: new Date('2027-12-28') },
      }),
    ).resolves.toBe(0);
    expect(await charges('2027-12-28')).toBe('100.00');
  });

  it('keeps installments immutable in the database', async () => {
    await expect(
      db().$executeRaw`UPDATE "card_installments" SET "number" = "number"`,
    ).rejects.toThrow(/immutable/u);
  });
});

function audit(
  resourceId: string,
  resourceType: 'account' | 'credit-card',
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: ownerId,
    id: randomUUID(),
    occurredAt: new Date('2026-09-22T17:00:00.000Z'),
    ownerId,
    resourceId,
    resourceType,
  });
}
