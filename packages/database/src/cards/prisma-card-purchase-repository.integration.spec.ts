import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import {
  IdempotencyConflictError,
  InvoiceSettlementExceedsRemainingError,
  invoiceRemaining,
  type CardPurchaseWrite,
  type IdempotencyRequest,
} from '@seshat/application';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Account,
  AccountType,
  CardCycleSchedule,
  CardInvoice,
  CardPurchase,
  CivilDate,
  CreditCard,
  Currency,
  FinancialAuditEvent,
  InvoiceSettlement,
  Money,
  Transaction,
} from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaCardInvoiceRepository } from './prisma-card-invoice-repository.js';
import { PrismaCardPurchaseRepository } from './prisma-card-purchase-repository.js';
import { PrismaCreditCardRepository } from './prisma-credit-card-repository.js';
import { PrismaInvoiceSettlementRepository } from './prisma-invoice-settlement-repository.js';
import { PrismaTransactionRepository } from '../transactions/prisma-transaction-repository.js';

const ownerId = '99999999-9999-4999-8999-999999999999';
const otherId = '88888888-8888-4888-8888-888888888888';
const accountId = '11111111-1111-4111-8111-111111111111';
const cardId = '22222222-2222-4222-8222-222222222222';
const brl = Currency.create('BRL', 2);
const schedule = CardCycleSchedule.create({
  closingBoundary: 'next-cycle',
  closingDay: 28,
  dueDay: 7,
});

describe('card purchases and invoices in PostgreSQL', () => {
  let stop: (() => Promise<void>) | undefined;
  let client: PrismaClient | undefined;
  let purchases: PrismaCardPurchaseRepository | undefined;
  let invoices: PrismaCardInvoiceRepository | undefined;

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
    purchases = new PrismaCardPurchaseRepository(client);
    invoices = new PrismaCardInvoiceRepository(client);
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

  it('forms the invoice with the first purchase and never touches the paying account', async () => {
    if (
      client === undefined ||
      purchases === undefined ||
      invoices === undefined
    )
      throw unavailable();

    await record('120.35', randomUUID(), '2026-10');
    await record('10.00', randomUUID(), '2026-10');

    const view = await invoices.findForCard(cardId, '2026-10-28', ownerId);
    expect(view?.invoice.toSnapshot()).toMatchObject({
      dueOn: '2026-11-09',
      status: 'open',
    });
    expect(view?.purchasesTotal.toDecimal()).toBe('130.35');
    expect(view?.purchaseCount).toBe(2);
    await expect(
      client.transaction.count({ where: { accountId } }),
    ).resolves.toBe(0);
    await expect(
      client.cardInvoice.count({ where: { closesOn: new Date('2026-10-28') } }),
    ).resolves.toBe(1);
  });

  it('replays an identical key and rejects a different payload without writing', async () => {
    if (client === undefined) throw unavailable();
    const key = randomUUID();
    const first = await record('7.00', key, '2026-10');
    const before = await client.cardPurchase.count();

    await expect(record('7.00', key, '2026-10')).resolves.toBe(first);
    await expect(record('8.00', key, '2026-10')).rejects.toThrow(
      IdempotencyConflictError,
    );
    await expect(client.cardPurchase.count()).resolves.toBe(before);
  });

  it('closes once, freezes the total and routes later purchases to the next invoice', async () => {
    if (client === undefined || invoices === undefined) throw unavailable();
    const close = (): ReturnType<
      PrismaCardInvoiceRepository['closeAtomically']
    > =>
      invoiceRepository().closeAtomically(
        cardId,
        '2026-10-28',
        ownerId,
        (invoice, total) => ({
          auditEvent: FinancialAuditEvent.create({
            action: 'closed',
            actorId: ownerId,
            id: randomUUID(),
            occurredAt: new Date('2026-10-29T12:00:00.000Z'),
            ownerId,
            resourceId: invoice.id,
            resourceType: 'card-invoice',
          }),
          invoice: invoice.close(total, new Date('2026-10-29T12:00:00.000Z')),
        }),
      );

    const results = await Promise.all([close(), close(), close()]);
    for (const result of results) {
      expect(result?.invoice.toSnapshot()).toMatchObject({
        closedTotal: { amount: '137.35' },
        status: 'closed',
        version: 2,
      });
    }
    await expect(
      client.financialAuditEvent.count({ where: { action: 'closed' } }),
    ).resolves.toBe(1);

    const late = JSON.parse(await record('3.00', randomUUID(), '2026-10')) as {
      cycleClosesOn: string;
      postedAfterClose: boolean;
    };
    expect(late).toMatchObject({
      cycleClosesOn: '2026-11-28',
      postedAfterClose: true,
    });
    const closed = await invoices.findForCard(cardId, '2026-10-28', ownerId);
    expect(closed?.invoice.toSnapshot().closedTotal?.amount).toBe('137.35');
    expect(closed?.purchasesTotal.toDecimal()).toBe('137.35');
  });

  it('keeps a closed invoice immutable at the database', async () => {
    if (client === undefined) throw unavailable();
    await expect(
      client.cardInvoice.updateMany({
        data: { status: 'open', closedAt: null, closedTotalMinorUnits: null },
        where: { closesOn: new Date('2026-10-28') },
      }),
    ).rejects.toThrow();
  });

  it('isolates invoices and purchases by owner', async () => {
    if (purchases === undefined || invoices === undefined) throw unavailable();
    await expect(invoices.listForCard(cardId, otherId)).resolves.toEqual([]);
    await expect(
      invoices.findForCard(cardId, '2026-10-28', otherId),
    ).resolves.toBeNull();
    await expect(purchases.listForCard(cardId, otherId)).resolves.toEqual([]);
    expect(
      (await invoices.listForCard(cardId, ownerId)).map((view) =>
        view.invoice.closesOn.toString(),
      ),
    ).toEqual(['2026-11-28', '2026-10-28']);
  });

  it('settles part of the invoice: account and obligation drop by the same amount', async () => {
    if (client === undefined || invoices === undefined) throw unavailable();
    const before = await client.financialAuditEvent.count();

    await expect(settle('100.00', randomUUID())).resolves.not.toBeNull();

    const view = await invoices.findForCard(cardId, '2026-10-28', ownerId);
    expect(view?.settledTotal.toDecimal()).toBe('100.00');
    expect(view?.purchasesTotal.toDecimal()).toBe('137.35');
    const movements = await client.transaction.findMany({
      where: { accountId },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.kind).toBe('expense');
    expect(movements[0]?.amountMinorUnits.toFixed(0)).toBe('10000');
    await expect(client.financialAuditEvent.count()).resolves.toBe(before + 2);
  });

  it('rejects a payment above the remaining obligation without writing', async () => {
    if (client === undefined) throw unavailable();
    const before = await client.invoiceSettlement.count();

    await expect(settle('37.36', randomUUID())).rejects.toThrow(
      InvoiceSettlementExceedsRemainingError,
    );
    await expect(client.invoiceSettlement.count()).resolves.toBe(before);
    await expect(
      client.transaction.count({ where: { accountId } }),
    ).resolves.toBe(1);
  });

  it('never lets concurrent payments exceed the obligation', async () => {
    if (client === undefined || invoices === undefined) throw unavailable();

    const results = await Promise.allSettled([
      settle('30.00', randomUUID()),
      settle('30.00', randomUUID()),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const view = await invoices.findForCard(cardId, '2026-10-28', ownerId);
    expect(view?.settledTotal.toDecimal()).toBe('130.00');
    expect(view === null ? undefined : invoiceRemaining(view).toDecimal()).toBe(
      '7.35',
    );
  });

  it('freezes the settlement movement and keeps it out of expense totals', async () => {
    if (client === undefined) throw unavailable();
    const movement = await client.transaction.findFirstOrThrow({
      where: { accountId, cardSettlement: { isNot: null } },
    });
    await expect(
      client.transaction.update({
        data: { lifecycle: 'trashed', trashedAt: new Date() },
        where: { id: movement.id },
      }),
    ).rejects.toThrow();
    const temporal = await new PrismaTransactionRepository(
      client,
    ).listWithTimeZoneForOwnerBetween(
      ownerId,
      new Date('2026-11-01T00:00:00.000Z'),
      new Date('2026-12-01T00:00:00.000Z'),
      'active',
    );
    expect(temporal.length).toBeGreaterThan(0);
    expect(temporal.every((item) => item.cardSettlement === true)).toBe(true);
    await expect(
      new PrismaTransactionRepository(
        client,
      ).findCardSettlementIdByEntryForOwner(movement.id, ownerId),
    ).resolves.not.toBeNull();
  });

  function settle(amount: string, key: string): Promise<string | null> {
    if (client === undefined) throw unavailable();
    const money = Money.fromDecimal(amount, brl);
    const transaction = Transaction.create({
      accountId,
      amount: money,
      createdAt: new Date('2026-11-05T12:00:00.000Z'),
      description: 'Pagamento da fatura',
      id: randomUUID(),
      kind: 'expense',
      occurredAt: new Date('2026-11-05T10:00:00.000Z'),
      ownerId,
    });
    const settlement = InvoiceSettlement.create({
      accountId,
      amount: money,
      cardId,
      createdAt: new Date('2026-11-05T12:00:00.000Z'),
      id: randomUUID(),
      invoiceClosesOn: CivilDate.parse('2026-10-28'),
      ownerId,
      paidAt: new Date('2026-11-05T10:00:00.000Z'),
      transactionId: transaction.id,
    });
    return new PrismaInvoiceSettlementRepository(client).settleAtomically(
      {
        key,
        operation: 'invoice-settlement.create',
        ownerId,
        payload: { amount },
        requestedAt: new Date('2026-11-05T12:00:00.000Z'),
      },
      cardId,
      '2026-10-28',
      {
        auditEvents: [
          audit(transaction.id, 'transaction'),
          audit(settlement.id, 'invoice-settlement'),
        ],
        response: JSON.stringify(settlement.toSnapshot()),
        settlement,
        transaction,
      },
    );
  }

  function invoiceRepository(): PrismaCardInvoiceRepository {
    if (invoices === undefined) throw unavailable();
    return invoices;
  }

  function purchaseRepository(): PrismaCardPurchaseRepository {
    if (purchases === undefined) throw unavailable();
    return purchases;
  }

  function record(amount: string, key: string, month: string): Promise<string> {
    const [year, monthNumber] = month.split('-').map(Number) as [
      number,
      number,
    ];
    const candidates = [0, 1, 2].map((offset) => {
      const index = year * 12 + (monthNumber - 1) + offset;
      return CardInvoice.form({
        cardId,
        closingBoundary: 'next-cycle',
        createdAt: new Date('2026-10-20T15:00:00.000Z'),
        currency: brl,
        cycle: schedule.cycleClosingIn(
          Math.floor(index / 12),
          (index % 12) + 1,
          () => false,
        ),
        holidayDatasetVersion: 'v-test',
        id: randomUUID(),
        ownerId,
        timeZone: 'America/Sao_Paulo',
      });
    });
    const request: IdempotencyRequest = {
      key,
      operation: 'card-purchase.create',
      ownerId,
      payload: { amount, cardId },
      requestedAt: new Date('2026-10-20T15:00:00.000Z'),
    };
    const id = randomUUID();
    return purchaseRepository().insertAtomically(
      request,
      candidates,
      (invoice, postedAfterClose): CardPurchaseWrite => {
        const purchase = CardPurchase.create({
          amount: Money.fromDecimal(amount, brl),
          cardId,
          createdAt: new Date('2026-10-20T15:00:00.000Z'),
          cycleClosesOn: invoice.closesOn,
          description: 'Compra',
          id,
          occurredAt: new Date('2026-10-20T14:00:00.000Z'),
          ownerId,
          postedAfterClose,
        });
        return {
          auditEvent: audit(id, 'card-purchase'),
          purchase,
          response: JSON.stringify(purchase.toSnapshot()),
        };
      },
    );
  }
});

function audit(
  resourceId: string,
  resourceType:
    | 'account'
    | 'credit-card'
    | 'card-purchase'
    | 'transaction'
    | 'invoice-settlement',
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action: 'created',
    actorId: ownerId,
    id: randomUUID(),
    occurredAt: new Date('2026-10-20T15:00:00.000Z'),
    ownerId,
    resourceId,
    resourceType,
  });
}

function unavailable(): Error {
  return new Error('Card persistence is unavailable.');
}
