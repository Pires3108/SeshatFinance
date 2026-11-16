import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  CardCycleResolver,
  EMPTY_HOLIDAY_SETTINGS,
  GetCardInstallmentPlanChainUseCase,
  IdempotencyConflictError,
  PrepayCardInstallmentPlanUseCase,
  RegisterCardInstallmentPlanUseCase,
  RegisterCardPurchaseUseCase,
  RenegotiateCardInstallmentPlanUseCase,
  ReverseCardInstallmentPlanChangeUseCase,
} from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  CardPlanPrepaymentMismatchError,
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

const ownerId = '99999999-9999-4999-8999-999999999999';
const accountId = '11111111-1111-4111-8111-111111111111';
const brl = Currency.create('BRL', 2);
// 16/11/2026: the open cycle closes on 28/11/2026.
const clock = { now: (): Date => new Date('2026-11-16T15:00:00.000Z') };
const identifiers = { generate: (): string => randomUUID() };
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

describe('card installment plan changes in PostgreSQL (US-046, INV-017, INV-019)', () => {
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
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await client?.$disconnect();
    await stop?.();
  });

  function db(): PrismaClient {
    if (client === undefined) throw new Error('PostgreSQL unavailable.');
    return client;
  }

  const plans = (): PrismaCardInstallmentPlanRepository =>
    new PrismaCardInstallmentPlanRepository(db());
  const cards = (): PrismaCreditCardRepository =>
    new PrismaCreditCardRepository(db());
  const args = (): ConstructorParameters<
    typeof PrepayCardInstallmentPlanUseCase
  > => [cards(), plans(), plans(), resolver, clock, identifiers];

  /** A fresh card with one 100.00 purchase split in 3x from November. */
  async function installed(): Promise<{ cardId: string; purchaseId: string }> {
    const cardId = randomUUID();
    await cards().insert(
      CreditCard.create({
        brand: 'Visa',
        closingDay: 28,
        createdAt: new Date('2026-09-22T18:00:00.000Z'),
        dueDay: 7,
        id: cardId,
        limit: Money.fromDecimal('3500.00', brl),
        name: `Cartão ${cardId.slice(0, 4)}`,
        ownerId,
        paymentAccountId: accountId,
      }),
      audit(cardId, 'credit-card'),
    );
    const purchase = await new RegisterCardPurchaseUseCase(
      cards(),
      new PrismaCardPurchaseRepository(db()),
      { findByIdForOwner: () => Promise.resolve(null) },
      resolver,
      clock,
      identifiers,
    ).execute({
      actorId: ownerId,
      amount: '100.00',
      cardId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: 'Geladeira',
      idempotencyKey: randomUUID(),
      occurredAt: new Date('2026-11-10T15:00:00.000Z'),
    });
    await new RegisterCardInstallmentPlanUseCase(
      cards(),
      plans(),
      resolver,
      clock,
      identifiers,
    ).execute({
      actorId: ownerId,
      cardId,
      count: 3,
      idempotencyKey: randomUUID(),
      purchaseId: purchase.id,
      rate: null,
    });
    return { cardId, purchaseId: purchase.id };
  }

  async function charges(cardId: string): Promise<Record<string, string>> {
    const views = await new PrismaCardInvoiceRepository(db()).listForCard(
      cardId,
      ownerId,
    );
    return Object.fromEntries(
      views.map((view) => [
        view.invoice.closesOn.toString(),
        view.purchasesTotal.toDecimal(),
      ]),
    );
  }

  it('moves the future installments into the open invoice when prepaid', async () => {
    const { cardId, purchaseId } = await installed();
    const view = await new PrepayCardInstallmentPlanUseCase(...args()).execute({
      actorId: ownerId,
      amount: '60.00',
      cardId,
      discount: '6.67',
      idempotencyKey: randomUUID(),
      purchaseId,
    });

    expect(view.plans[0]?.state.installments.map((i) => i.situation)).toEqual([
      'invoiced',
      'prepaid',
      'prepaid',
    ]);
    expect(await charges(cardId)).toEqual({
      '2026-11-28': '93.33',
      '2026-12-28': '0.00',
      '2027-01-28': '0.00',
    });
    // The invoice detail lists what composes the total (INV-017).
    const november = await plans().listForCycle(cardId, '2026-11-28', ownerId);
    expect(
      november.map((line) => [line.kind, line.number, line.amount.toDecimal()]),
    ).toEqual([
      ['installment', 1, '33.33'],
      ['prepayment', 0, '60.00'],
    ]);
    await expect(
      plans().listForCycle(cardId, '2026-12-28', ownerId),
    ).resolves.toEqual([]);
  });

  it('refuses a prepayment that does not close the future installments, without writing', async () => {
    const { cardId, purchaseId } = await installed();

    await expect(
      new PrepayCardInstallmentPlanUseCase(...args()).execute({
        actorId: ownerId,
        amount: '60.00',
        cardId,
        discount: '0.00',
        idempotencyKey: randomUUID(),
        purchaseId,
      }),
    ).rejects.toThrow(CardPlanPrepaymentMismatchError);
    expect(await charges(cardId)).toMatchObject({ '2026-12-28': '33.33' });
  });

  it('replays the same key once and restores the schedule after a reversal', async () => {
    const { cardId, purchaseId } = await installed();
    const key = randomUUID();
    const command = {
      actorId: ownerId,
      amount: '66.67',
      cardId,
      discount: '0.00',
      idempotencyKey: key,
      purchaseId,
    };
    const first = await new PrepayCardInstallmentPlanUseCase(...args()).execute(
      command,
    );
    await new PrepayCardInstallmentPlanUseCase(...args()).execute(command);
    await expect(
      new PrepayCardInstallmentPlanUseCase(...args()).execute({
        ...command,
        amount: '60.00',
        discount: '6.67',
      }),
    ).rejects.toThrow(IdempotencyConflictError);
    expect(first.plans[0]?.changes).toHaveLength(1);

    const changeId = first.plans[0]?.changes[0]?.id ?? '';
    const reversed = await new ReverseCardInstallmentPlanChangeUseCase(
      ...args(),
    ).execute({
      actorId: ownerId,
      cardId,
      changeId,
      idempotencyKey: randomUUID(),
      purchaseId,
      reason: 'Antecipação lançada por engano',
    });

    expect(reversed.plans[0]?.state.status).toBe('active');
    expect(await charges(cardId)).toEqual({
      '2026-11-28': '33.33',
      '2026-12-28': '33.33',
      '2027-01-28': '33.34',
    });
  });

  it('renegotiates into a new linked plan with its own version and audit', async () => {
    const { cardId, purchaseId } = await installed();
    const view = await new RenegotiateCardInstallmentPlanUseCase(
      ...args(),
    ).execute({
      actorId: ownerId,
      cardId,
      count: 2,
      idempotencyKey: randomUUID(),
      principal: '66.67',
      purchaseId,
      rate: {
        method: 'compound',
        percentPerPeriod: '2',
        periodicity: 'monthly',
      },
    });

    expect(view.plans).toHaveLength(2);
    const [original, renewed] = view.plans;
    expect(original?.state.status).toBe('renegotiated');
    expect(renewed?.plan.toSnapshot()).toMatchObject({
      calculationVersion: 1,
      renegotiatedFromId: original?.plan.id,
      total: { amount: '69.36' },
    });
    // 66.67 × 1.02² = 69.364668 → 69.36, split 34.68 + 34.68.
    expect(await charges(cardId)).toEqual({
      '2026-11-28': '33.33',
      '2026-12-28': '34.68',
      '2027-01-28': '34.68',
    });
    await expect(
      db().financialAuditEvent.count({
        where: {
          resourceId: { in: [original?.plan.id ?? '', renewed?.plan.id ?? ''] },
          resourceType: 'card_installment_plan',
        },
      }),
    ).resolves.toBe(3);
    const chain = await new GetCardInstallmentPlanChainUseCase(
      cards(),
      plans(),
      plans(),
      resolver,
      clock,
    ).execute({ actorId: ownerId, cardId, purchaseId });
    expect(chain.plans.map((item) => item.plan.id)).toEqual([
      original?.plan.id,
      renewed?.plan.id,
    ]);
  });

  it('keeps plan changes append-only', async () => {
    await expect(
      db()
        .$executeRaw`UPDATE "card_installment_plan_changes" SET "reason" = 'x'`,
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
