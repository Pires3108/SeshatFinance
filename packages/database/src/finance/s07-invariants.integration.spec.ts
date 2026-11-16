import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  CardCycleResolver,
  CreateLoanUseCase,
  EMPTY_HOLIDAY_SETTINGS,
  GetLoanUseCase,
  LoanCalendar,
  PrepayCardInstallmentPlanUseCase,
  RecordLoanEventUseCase,
  RegisterCardInstallmentPlanUseCase,
  RegisterCardPurchaseUseCase,
  RenegotiateCardInstallmentPlanUseCase,
  ReverseCardInstallmentPlanChangeUseCase,
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
import { PrismaCardInstallmentPlanRepository } from '../cards/prisma-card-installment-plan-repository.js';
import { PrismaCardInvoiceRepository } from '../cards/prisma-card-invoice-repository.js';
import { PrismaCardPurchaseRepository } from '../cards/prisma-card-purchase-repository.js';
import { PrismaCreditCardRepository } from '../cards/prisma-credit-card-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaLoanRepository } from '../loans/prisma-loan-repository.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const accountId = '11111111-1111-4111-8111-111111111111';
const brl = Currency.create('BRL', 2);
const clock = { now: (): Date => new Date('2026-11-16T15:00:00.000Z') };
const identifiers = { generate: (): string => randomUUID() };
const profiles = {
  changeTimeZone: () => Promise.resolve(null),
  findById: () => Promise.resolve(null),
  upsert: <T>(profile: T) => Promise.resolve(profile),
};
const holidays = {
  addDeclared: () => Promise.resolve(),
  findForOwner: () => Promise.resolve(EMPTY_HOLIDAY_SETTINGS),
  removeDeclared: () => Promise.resolve(false),
  saveLocation: () => Promise.resolve(),
};
const resolver = new CardCycleResolver(profiles, holidays);
const calendar = new LoanCalendar(profiles, holidays, clock);

/**
 * Sprint 7 invariants (US-048): after every operation the stored state is
 * recomputed independently in SQL and compared with what the repositories
 * report, so a defect in either side shows up as a mismatch.
 */
describe('S07 invariants in PostgreSQL (INV-005, INV-017 to INV-019, INV-048)', () => {
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
  const changeArgs = (): ConstructorParameters<
    typeof PrepayCardInstallmentPlanUseCase
  > => [cards(), plans(), plans(), resolver, clock, identifiers];

  /** Plan totals close against their installments and their purchase. */
  async function assertPlansClose(): Promise<void> {
    const mismatches = await db().$queryRaw<{ id: string }[]>`
      SELECT plan."id"
      FROM "card_installment_plans" plan
      JOIN "card_installments" i ON i."plan_id" = plan."id"
      GROUP BY plan."id", plan."total_minor_units",
               plan."principal_minor_units", plan."interest_minor_units"
      HAVING SUM(i."amount_minor_units") <> plan."total_minor_units"
          OR SUM(i."principal_minor_units") <> plan."principal_minor_units"
          OR SUM(i."interest_minor_units") <> plan."interest_minor_units"
    `;
    expect(mismatches).toEqual([]);
    const roots = await db().$queryRaw<{ id: string }[]>`
      SELECT plan."id" FROM "card_installment_plans" plan
      JOIN "card_purchases" p ON p."id" = plan."purchase_id"
      WHERE plan."renegotiated_from_id" IS NULL
        AND plan."principal_minor_units" <> p."amount_minor_units"
    `;
    expect(roots).toEqual([]);
  }

  /** Invoice totals equal an independent SQL recomputation (INV-017). */
  async function assertInvoicesReconcile(cardId: string): Promise<void> {
    const expected = await db().$queryRaw<{ closes_on: Date; total: string }[]>`
      WITH active_changes AS (
        SELECT c.* FROM "card_installment_plan_changes" c
        WHERE c."kind" <> 'reversal'
          AND c."id" NOT IN (
            SELECT "reversed_change_id" FROM "card_installment_plan_changes"
            WHERE "kind" = 'reversal'
          )
      )
      SELECT inv."closes_on",
             (
               COALESCE((SELECT SUM(p."amount_minor_units") FROM "card_purchases" p
                 WHERE p."card_id" = inv."card_id"
                   AND p."cycle_closes_on" = inv."closes_on"
                   AND p."id" NOT IN (SELECT "purchase_id" FROM "card_installment_plans")), 0)
             + COALESCE((SELECT SUM(i."amount_minor_units") FROM "card_installments" i
                 WHERE i."card_id" = inv."card_id"
                   AND i."cycle_closes_on" = inv."closes_on"
                   AND NOT EXISTS (
                     SELECT 1 FROM active_changes c
                     WHERE c."plan_id" = i."plan_id"
                       AND c."effective_cycle_closes_on" < i."cycle_closes_on"
                   )), 0)
             + COALESCE((SELECT SUM(c."amount_minor_units") FROM active_changes c
                 JOIN "card_installment_plans" plan ON plan."id" = c."plan_id"
                 WHERE plan."card_id" = inv."card_id"
                   AND c."kind" = 'prepayment'
                   AND c."effective_cycle_closes_on" = inv."closes_on"), 0)
             )::text AS "total"
      FROM "card_invoices" inv
      WHERE inv."card_id" = ${cardId}::uuid
      ORDER BY inv."closes_on"
    `;
    const reported = await new PrismaCardInvoiceRepository(db()).listForCard(
      cardId,
      ownerId,
    );
    const byCycle = new Map(
      reported.map((view) => [
        view.invoice.closesOn.toString(),
        view.purchasesTotal.toMinorUnits().toString(),
      ]),
    );
    for (const row of expected) {
      expect(byCycle.get(row.closes_on.toISOString().slice(0, 10))).toBe(
        row.total,
      );
    }
    expect(byCycle.size).toBe(expected.length);
  }

  it('keeps card plans and invoices reconciled through every plan change', async () => {
    const cardId = randomUUID();
    await cards().insert(
      CreditCard.create({
        brand: 'Visa',
        closingDay: 28,
        createdAt: new Date('2026-09-22T18:00:00.000Z'),
        dueDay: 7,
        id: cardId,
        limit: Money.fromDecimal('9000.00', brl),
        name: 'Cartão das invariantes',
        ownerId,
        paymentAccountId: accountId,
      }),
      audit(cardId, 'credit-card'),
    );
    const record = (amount: string): Promise<string> =>
      new RegisterCardPurchaseUseCase(
        cards(),
        new PrismaCardPurchaseRepository(db()),
        { findByIdForOwner: () => Promise.resolve(null) },
        resolver,
        clock,
        identifiers,
      )
        .execute({
          actorId: ownerId,
          amount,
          cardId,
          currencyCode: 'BRL',
          currencyMinorUnitScale: 2,
          description: `Compra ${amount}`,
          idempotencyKey: randomUUID(),
          occurredAt: new Date('2026-11-10T15:00:00.000Z'),
        })
        .then((purchase) => purchase.id);
    const install = async (
      purchaseId: string,
      count: number,
      rate: {
        method: string;
        percentPerPeriod: string;
        periodicity: string;
      } | null,
    ): Promise<void> => {
      await new RegisterCardInstallmentPlanUseCase(
        cards(),
        plans(),
        resolver,
        clock,
        identifiers,
      ).execute({
        actorId: ownerId,
        cardId,
        count,
        idempotencyKey: randomUUID(),
        purchaseId,
        rate,
      });
    };

    await record('25.00');
    const prepaid = await record('100.00');
    const renegotiated = await record('333.33');
    await install(prepaid, 3, null);
    await install(renegotiated, 7, {
      method: 'compound',
      percentPerPeriod: '1.99',
      periodicity: 'monthly',
    });
    await assertPlansClose();
    await assertInvoicesReconcile(cardId);

    const prepayment = await new PrepayCardInstallmentPlanUseCase(
      ...changeArgs(),
    ).execute({
      actorId: ownerId,
      amount: '60.00',
      cardId,
      discount: '6.67',
      idempotencyKey: randomUUID(),
      purchaseId: prepaid,
    });
    await assertInvoicesReconcile(cardId);

    await new ReverseCardInstallmentPlanChangeUseCase(...changeArgs()).execute({
      actorId: ownerId,
      cardId,
      changeId: prepayment.plans[0]?.changes[0]?.id ?? '',
      idempotencyKey: randomUUID(),
      purchaseId: prepaid,
      reason: 'Correção',
    });
    await assertInvoicesReconcile(cardId);

    const chain = await new RenegotiateCardInstallmentPlanUseCase(
      ...changeArgs(),
    ).execute({
      actorId: ownerId,
      cardId,
      count: 5,
      idempotencyKey: randomUUID(),
      principal: '300.00',
      purchaseId: renegotiated,
      rate: {
        method: 'simple',
        percentPerPeriod: '2.5',
        periodicity: 'monthly',
      },
    });
    expect(chain.plans).toHaveLength(2);
    await assertPlansClose();
    await assertInvoicesReconcile(cardId);
  });

  it('derives the loan pending balance exactly once per event (INV-048)', async () => {
    const repository = new PrismaLoanRepository(db());
    const loan = await new CreateLoanUseCase(
      repository,
      { findByIdForOwner: () => Promise.resolve(null) },
      calendar,
      identifiers,
    ).execute({
      actorId: ownerId,
      businessDayRule: 'none',
      contractedOn: '2026-01-10',
      count: 12,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: 'Financiamento',
      direction: 'payable',
      firstDueOn: '2026-02-10',
      idempotencyKey: randomUUID(),
      principal: '5000.00',
      profile: 'decreasing',
      rate: {
        method: 'compound',
        percentPerPeriod: '1.5',
        periodicity: 'monthly',
      },
    });
    const loanId = loan.loan.id;
    const [schedule] = await db().$queryRaw<
      { total: string; principal: string }[]
    >`
      SELECT SUM("amount_minor_units")::text AS "total",
             SUM("principal_minor_units")::text AS "principal"
      FROM "loan_installments" WHERE "loan_id" = ${loanId}::uuid
    `;
    expect(schedule?.principal).toBe('500000');

    // First SAC installment: 416.67 principal + 75.00 interest = 491.67.
    const record = new RecordLoanEventUseCase(
      repository,
      calendar,
      identifiers,
    );
    const key = randomUUID();
    const first = await record.execute({
      actorId: ownerId,
      event: { amount: '400.00', kind: 'payment', occurredOn: '2026-02-10' },
      idempotencyKey: key,
      loanId,
    });
    await record.execute({
      actorId: ownerId,
      event: { amount: '400.00', kind: 'payment', occurredOn: '2026-02-10' },
      idempotencyKey: key,
      loanId,
    });
    await record.execute({
      actorId: ownerId,
      event: { amount: '100.00', kind: 'payment', occurredOn: '2026-03-10' },
      idempotencyKey: randomUUID(),
      loanId,
    });
    await record.execute({
      actorId: ownerId,
      event: {
        kind: 'reversal',
        reason: 'Pagamento duplicado no extrato',
        reversedEventId: first.events[0]?.id ?? '',
      },
      idempotencyKey: randomUUID(),
      loanId,
    });

    const [paid] = await db().$queryRaw<{ paid: string }[]>`
      SELECT COALESCE(SUM(e."amount_minor_units"), 0)::text AS "paid"
      FROM "loan_events" e
      WHERE e."loan_id" = ${loanId}::uuid AND e."kind" = 'payment'
        AND e."id" NOT IN (
          SELECT "reversed_event_id" FROM "loan_events"
          WHERE "kind" = 'reversal' AND "loan_id" = ${loanId}::uuid
        )
    `;
    const view = await new GetLoanUseCase(repository, calendar).execute({
      actorId: ownerId,
      loanId,
    });
    // No fee configured and no credit: pending = schedule − active payments.
    expect(view.state.pending.toMinorUnits()).toBe(
      BigInt(schedule?.total ?? '0') - BigInt(paid?.paid ?? '0'),
    );
    expect(paid?.paid).toBe('10000');
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
