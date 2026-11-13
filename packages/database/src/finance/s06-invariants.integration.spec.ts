import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  CardCycleResolver,
  CardPurchaseCurrencyMismatchError,
  CloseCardInvoiceUseCase,
  CreateCreditCardUseCase,
  CreditCardNotFoundError,
  DeclareInvoiceSettlementUseCase,
  GetCardInvoiceUseCase,
  IdempotencyConflictError,
  InvoiceDueStateResolver,
  InvoiceSettlementExceedsRemainingError,
  ListCardInvoicesUseCase,
  ListTemporalTransactionsUseCase,
  RegisterCardPurchaseUseCase,
  type DeclareInvoiceSettlementCommand,
  type RegisterCardPurchaseCommand,
} from '@seshat/application';
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

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import { PrismaFinancialAuditEventRepository } from '../audit/prisma-financial-audit-event-repository.js';
import { PrismaCardInvoiceRepository } from '../cards/prisma-card-invoice-repository.js';
import { PrismaCardPurchaseRepository } from '../cards/prisma-card-purchase-repository.js';
import { PrismaCreditCardRepository } from '../cards/prisma-credit-card-repository.js';
import { PrismaInvoiceSettlementRepository } from '../cards/prisma-invoice-settlement-repository.js';
import { PrismaCategoryRepository } from '../classifications/prisma-category-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';
import { PrismaHolidaySettingsRepository } from '../users/prisma-holiday-settings-repository.js';
import { PrismaUserProfileRepository } from '../users/prisma-user-profile-repository.js';

/**
 * US-043: S06 invariants (INV-014 to INV-018) exercised through the real use
 * cases and PostgreSQL. After every step the account balance, the invoice
 * obligation and the expense result are compared with independent SQL.
 */
const ownerId = '43434343-4343-4343-8343-434343434343';
const otherId = '34343434-3434-4434-8434-343434343434';
const brl = Currency.create('BRL', 2);
const closesOn = '2026-10-28';

describe('S06 invariants (US-043)', () => {
  let stop: (() => Promise<void>) | undefined;
  let prisma: PrismaClient;
  let accounts: PrismaAccountRepository;
  let cards: PrismaCreditCardRepository;
  let invoices: PrismaCardInvoiceRepository;
  let purchases: PrismaCardPurchaseRepository;
  let settlements: PrismaInvoiceSettlementRepository;
  let transactions: PrismaTransactionRepository;
  let profiles: PrismaUserProfileRepository;
  let auditTrail: PrismaFinancialAuditEventRepository;
  let accountId = '';
  let cardId = '';
  let now = new Date('2026-10-20T15:00:00.000Z');
  const clock = { now: (): Date => new Date(now) };
  const ids = { generate: (): string => randomUUID() };

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const client = new Client({
      connectionString: container.getConnectionUri(),
    });
    await client.connect();
    const migrations = new URL('../../prisma/migrations/', import.meta.url);
    for (const name of (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()) {
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'),
      );
    }
    await client.end();
    prisma = createPrismaClient(container.getConnectionUri());
    accounts = new PrismaAccountRepository(prisma);
    cards = new PrismaCreditCardRepository(prisma);
    invoices = new PrismaCardInvoiceRepository(prisma);
    purchases = new PrismaCardPurchaseRepository(prisma);
    settlements = new PrismaInvoiceSettlementRepository(prisma);
    transactions = new PrismaTransactionRepository(prisma);
    profiles = new PrismaUserProfileRepository(prisma);
    auditTrail = new PrismaFinancialAuditEventRepository(prisma);
    for (const id of [ownerId, otherId]) {
      await profiles.upsert({
        createdAt: clock.now(),
        displayName: null,
        id,
        locale: 'pt-BR',
        presentationCurrency: 'BRL',
        refundPresentation: 'separate-income',
        timeZone: 'America/Sao_Paulo',
        updatedAt: clock.now(),
        version: 1,
      });
    }
    accountId = await openAccount('1000.00');
    const card = await new CreateCreditCardUseCase(
      accounts,
      cards,
      clock,
      ids,
    ).execute({
      actorId: ownerId,
      brand: 'Visa',
      closingDay: 28,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      dueDay: 7,
      limit: '100.00',
      name: 'Cartão S06',
      paymentAccountId: accountId,
    });
    cardId = card.id;
  }, 120_000);

  afterAll(async (): Promise<void> => {
    await prisma.$disconnect();
    await stop?.();
  });

  async function openAccount(initial: string): Promise<string> {
    const id = randomUUID();
    await accounts.insert(
      Account.create({
        color: null,
        createdAt: clock.now(),
        description: null,
        icon: null,
        id,
        initialBalance: Money.fromDecimal(initial, brl),
        institution: null,
        name: 'Conta pagadora',
        ownerId,
        type: AccountType.create('checking-account'),
      }),
      FinancialAuditEvent.create({
        action: 'created',
        actorId: ownerId,
        id: randomUUID(),
        occurredAt: clock.now(),
        ownerId,
        resourceId: id,
        resourceType: 'account',
      }),
    );
    return id;
  }

  const resolver = (): CardCycleResolver =>
    new CardCycleResolver(
      profiles,
      new PrismaHolidaySettingsRepository(prisma),
    );
  const states = (): InvoiceDueStateResolver =>
    new InvoiceDueStateResolver(profiles, clock);
  const register = (
    command: Partial<RegisterCardPurchaseCommand>,
  ): ReturnType<RegisterCardPurchaseUseCase['execute']> =>
    new RegisterCardPurchaseUseCase(
      cards,
      purchases,
      new PrismaCategoryRepository(prisma),
      resolver(),
      clock,
      ids,
    ).execute({
      actorId: ownerId,
      amount: '120.35',
      cardId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: 'Compra',
      idempotencyKey: randomUUID(),
      occurredAt: new Date('2026-10-20T14:00:00.000Z'),
      ...command,
    });
  const settle = (
    command: Partial<DeclareInvoiceSettlementCommand>,
  ): ReturnType<DeclareInvoiceSettlementUseCase['execute']> =>
    new DeclareInvoiceSettlementUseCase(
      cards,
      accounts,
      settlements,
      clock,
      ids,
    ).execute({
      accountId,
      actorId: ownerId,
      amount: '10.00',
      cardId,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      idempotencyKey: randomUUID(),
      invoiceClosesOn: closesOn,
      paidAt: new Date('2026-11-05T13:00:00.000Z'),
      ...command,
    });
  const detail = (): ReturnType<GetCardInvoiceUseCase['execute']> =>
    new GetCardInvoiceUseCase(
      cards,
      invoices,
      purchases,
      settlements,
      states(),
    ).execute({ actorId: ownerId, cardId, closesOn });

  /** Independent recomputation of the three quantities S06 must keep. */
  async function ledger(): Promise<{
    balance: string;
    obligation: string;
    expense: string;
  }> {
    const [row] = await prisma.$queryRaw<
      { balance: string; obligation: string; expense: string }[]
    >`
      SELECT
        (SELECT (a.initial_balance_minor_units + COALESCE(SUM(
           CASE WHEN t.lifecycle = 'trashed' THEN 0
                WHEN t.kind = 'income' THEN t.amount_minor_units
                ELSE -t.amount_minor_units END), 0))::text
         FROM accounts a
         LEFT JOIN transactions t ON t.account_id = a.id
         WHERE a.id = ${accountId}::uuid
         GROUP BY a.initial_balance_minor_units) AS balance,
        ((SELECT COALESCE(SUM(amount_minor_units), 0) FROM card_purchases
          WHERE owner_id = ${ownerId}::uuid AND card_id = ${cardId}::uuid)
         - (SELECT COALESCE(SUM(amount_minor_units), 0) FROM invoice_settlements
          WHERE owner_id = ${ownerId}::uuid AND card_id = ${cardId}::uuid))::text
          AS obligation,
        ((SELECT COALESCE(SUM(amount_minor_units), 0) FROM card_purchases
          WHERE owner_id = ${ownerId}::uuid)
         + (SELECT COALESCE(SUM(t.amount_minor_units), 0) FROM transactions t
            WHERE t.owner_id = ${ownerId}::uuid AND t.kind = 'expense'
              AND t.lifecycle <> 'trashed'
              AND NOT EXISTS (SELECT 1 FROM invoice_settlements s
                              WHERE s.transaction_id = t.id)))::text AS expense`;
    if (row === undefined) throw new Error('Ledger unavailable.');
    return row;
  }

  it('INV-014: a purchase raises expense and obligation once and never the paying account', async () => {
    const before = await ledger();
    const key = randomUUID();

    await register({ idempotencyKey: key });
    await register({ idempotencyKey: key });

    expect(await ledger()).toEqual({
      balance: before.balance,
      expense: String(BigInt(before.expense) + 12035n),
      obligation: String(BigInt(before.obligation) + 12035n),
    });
    await expect(
      register({ amount: '1.00', idempotencyKey: key }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it('INV-014: concurrent retries with one key record a single purchase', async () => {
    const before = await ledger();
    const key = randomUUID();

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        register({ amount: '7.00', idempotencyKey: key }),
      ),
    );

    expect(
      BigInt((await ledger()).obligation) - BigInt(before.obligation),
    ).toBe(700n);
  });

  it('INV-016: the limit is organizational and never blocks a purchase', async () => {
    const before = await ledger();

    await register({ amount: '5000.00' });

    expect(
      BigInt((await ledger()).obligation) - BigInt(before.obligation),
    ).toBe(500000n);
    expect(
      (await cards.findByIdForOwner(cardId, ownerId))?.limit.toDecimal(),
    ).toBe('100.00');
  });

  it('INV-017: the invoice total equals its purchases minus settlements', async () => {
    const view = await detail();
    const sum = view.purchases.reduce(
      (total, purchase) => total + purchase.amount.toMinorUnits(),
      0n,
    );

    expect(view.purchasesTotal.toMinorUnits()).toBe(sum);
    expect(
      view.purchasesTotal.toMinorUnits() - view.settledTotal.toMinorUnits(),
    ).toBe(BigInt((await ledger()).obligation));
  });

  it('INV-015 and INV-018: a partial settlement lowers account and obligation equally, keeps the debt and adds no expense', async () => {
    const before = await ledger();
    now = new Date('2026-11-10T15:00:00.000Z');

    await settle({ amount: '100.00' });

    const after = await ledger();
    expect(BigInt(before.balance) - BigInt(after.balance)).toBe(10000n);
    expect(BigInt(before.obligation) - BigInt(after.obligation)).toBe(10000n);
    expect(after.expense).toBe(before.expense);
    const view = await detail();
    expect(view.due.state).toBe('overdue');
    const temporal = await new ListTemporalTransactionsUseCase(
      transactions,
      profiles,
    ).execute(ownerId, 'month', '2026-11-05');
    expect(temporal.totals.every((total) => total.expense === '0.00')).toBe(
      true,
    );
  });

  it('INV-018: concurrent settlements never exceed the remaining obligation', async () => {
    const remaining = BigInt((await ledger()).obligation);
    const amount = remaining / 2n + 1n;
    const decimal = `${String(amount / 100n)}.${String(amount % 100n).padStart(2, '0')}`;
    const settledBefore = await prisma.invoiceSettlement.count();

    const results = await Promise.allSettled([
      settle({ amount: decimal }),
      settle({ amount: decimal }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(
          InvoiceSettlementExceedsRemainingError,
        );
      }
    }
    await expect(prisma.invoiceSettlement.count()).resolves.toBe(
      settledBefore + 1,
    );
    expect(BigInt((await ledger()).obligation)).toBeGreaterThanOrEqual(0n);
  });

  it('INV-018: paying the exact remaining makes the invoice paid, never earlier', async () => {
    const remaining = BigInt((await ledger()).obligation);
    const decimal = `${String(remaining / 100n)}.${String(remaining % 100n).padStart(2, '0')}`;
    await expect(
      settle({ amount: `${String(remaining / 100n + 1n)}.00` }),
    ).rejects.toThrow(InvoiceSettlementExceedsRemainingError);

    await settle({ amount: decimal });

    expect((await ledger()).obligation).toBe('0');
    expect((await detail()).due.state).toBe('paid');
  });

  it('closing freezes the total, adds no expense and routes later purchases forward', async () => {
    const before = await ledger();
    const closed = await new CloseCardInvoiceUseCase(
      cards,
      invoices,
      clock,
      ids,
      states(),
    ).execute({ actorId: ownerId, cardId, closesOn });

    const late = await register({ amount: '3.00' });

    expect(closed.invoice.toSnapshot().closedTotal?.amount).toBe(
      closed.purchasesTotal.toDecimal(),
    );
    expect(late.toSnapshot()).toMatchObject({ postedAfterClose: true });
    expect(late.toSnapshot().cycleClosesOn > closesOn).toBe(true);
    const after = await ledger();
    expect(after.balance).toBe(before.balance);
    expect(BigInt(after.expense) - BigInt(before.expense)).toBe(300n);
  });

  it('refuses another holder and a different currency without leaking or writing', async () => {
    const before = await ledger();

    await expect(register({ actorId: otherId })).rejects.toThrow(
      CreditCardNotFoundError,
    );
    await expect(register({ currencyCode: 'USD' })).rejects.toThrow(
      CardPurchaseCurrencyMismatchError,
    );
    await expect(settle({ actorId: otherId })).rejects.toThrow(
      CreditCardNotFoundError,
    );
    await expect(
      new ListCardInvoicesUseCase(cards, invoices, states()).execute({
        actorId: otherId,
        cardId,
      }),
    ).rejects.toThrow(CreditCardNotFoundError);
    expect(await ledger()).toEqual(before);
  });

  it('keeps the owner audit hash chain valid after every scenario (INV-041)', async () => {
    const verification = await auditTrail.verifyChainForOwner(ownerId);
    expect(verification.firstInvalidSequence).toBeNull();
    expect(verification.checkedEvents).toBe(
      BigInt(await prisma.financialAuditEvent.count({ where: { ownerId } })),
    );
  });
});
