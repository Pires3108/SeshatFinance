import type {
  CardInvoiceRepository,
  CardInvoiceView,
} from '@seshat/application';
import {
  CARD_CLOSING_BOUNDARIES,
  CardInvoice,
  Currency,
  Money,
  type CardClosingBoundary,
  type FinancialAuditEvent,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { PrismaTransactionRunner } from '../prisma/prisma-transaction-runner.js';
import {
  civilDateToDate,
  dateToCivilDate,
  minorUnitsToDecimal,
} from './prisma-card-purchase-repository.js';

type QueryClient = PrismaClient | Prisma.TransactionClient;
type PersistedInvoice = NonNullable<
  Awaited<ReturnType<PrismaClient['cardInvoice']['findFirst']>>
>;

const MAX_INVOICES = 120;

/**
 * Forms the invoice if missing and locks its row for the transaction.
 * Returns its status; purchase routing and closing serialize on this lock.
 */
export async function lockOrFormInvoice(
  client: Prisma.TransactionClient,
  invoice: CardInvoice,
): Promise<'open' | 'closed'> {
  const value = invoice.toSnapshot();
  await client.cardInvoice.createMany({
    data: [invoiceCreateData(invoice)],
    skipDuplicates: true,
  });
  const [row] = await client.$queryRaw<{ status: string }[]>`
    SELECT "status" FROM "card_invoices"
    WHERE "owner_id" = ${value.ownerId}::uuid
      AND "card_id" = ${value.cardId}::uuid
      AND "closes_on" = ${civilDateToDate(value.closesOn)}::date
    FOR UPDATE
  `;
  if (row === undefined) throw new Error('Card invoice could not be locked.');
  return row.status === 'closed' ? 'closed' : 'open';
}

export class PrismaCardInvoiceRepository implements CardInvoiceRepository {
  private readonly transactions: PrismaTransactionRunner;

  public constructor(
    private readonly client: PrismaClient,
    transactions?: PrismaTransactionRunner,
  ) {
    this.transactions = transactions ?? new PrismaTransactionRunner(client);
  }

  public async listForCard(
    cardId: string,
    ownerId: string,
  ): Promise<readonly CardInvoiceView[]> {
    const rows = await this.client.cardInvoice.findMany({
      orderBy: [{ closesOn: 'desc' }],
      take: MAX_INVOICES,
      where: { cardId, ownerId },
    });
    const sums = await purchaseSums(this.client, cardId, ownerId);
    const settled = await settlementSums(this.client, cardId, ownerId);
    return rows.map((row) => view(row, sums, settled));
  }

  public async findForCard(
    cardId: string,
    closesOn: string,
    ownerId: string,
  ): Promise<CardInvoiceView | null> {
    const row = await this.client.cardInvoice.findFirst({
      where: { cardId, closesOn: civilDateToDate(closesOn), ownerId },
    });
    if (row === null) return null;
    return view(
      row,
      await purchaseSums(this.client, cardId, ownerId, closesOn),
      await settlementSums(this.client, cardId, ownerId, closesOn),
    );
  }

  public async closeAtomically(
    cardId: string,
    closesOn: string,
    ownerId: string,
    close: (
      invoice: CardInvoice,
      purchasesTotal: Money,
    ) => Readonly<{ invoice: CardInvoice; auditEvent: FinancialAuditEvent }>,
  ): Promise<CardInvoiceView | null> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const [locked] = await client.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "card_invoices"
        WHERE "owner_id" = ${ownerId}::uuid
          AND "card_id" = ${cardId}::uuid
          AND "closes_on" = ${civilDateToDate(closesOn)}::date
        FOR UPDATE
      `;
      if (locked === undefined) return null;
      const row = await client.cardInvoice.findUniqueOrThrow({
        where: { id: locked.id },
      });
      const sums = await purchaseSums(client, cardId, ownerId, closesOn);
      const settled = await settlementSums(client, cardId, ownerId, closesOn);
      const current = restoreInvoice(row);
      const total =
        sums.get(closesOn)?.total ?? Money.fromMinorUnits(0n, current.currency);
      const result = close(current, total);
      if (result.invoice.version === current.version)
        return view(row, sums, settled);
      const next = result.invoice.toSnapshot();
      const updated = await client.cardInvoice.update({
        data: {
          closedAt: next.closedAt,
          closedTotalMinorUnits:
            next.closedTotal === null
              ? null
              : Money.restore(next.closedTotal).toMinorUnits().toString(),
          status: next.status,
          version: next.version,
        },
        where: { id: row.id },
      });
      await insertFinancialAuditEvent(client, result.auditEvent);
      return view(updated, sums, settled);
    });
  }
}

type PurchaseSum = Readonly<{ count: number; total: Money }>;

async function purchaseSums(
  client: QueryClient,
  cardId: string,
  ownerId: string,
  closesOn?: string,
): Promise<ReadonlyMap<string, PurchaseSum>> {
  const groups = await client.cardPurchase.groupBy({
    _count: { _all: true },
    _sum: { amountMinorUnits: true },
    by: ['cycleClosesOn', 'currencyCode', 'currencyMinorUnitScale'],
    where: {
      cardId,
      ownerId,
      ...(closesOn === undefined
        ? {}
        : { cycleClosesOn: civilDateToDate(closesOn) }),
    },
  });
  return new Map(
    groups.map((group) => [
      dateToCivilDate(group.cycleClosesOn),
      {
        count: group._count._all,
        total: Money.fromMinorUnits(
          BigInt((group._sum.amountMinorUnits ?? 0).toFixed(0)),
          Currency.create(group.currencyCode, group.currencyMinorUnitScale),
        ),
      },
    ]),
  );
}

async function settlementSums(
  client: QueryClient,
  cardId: string,
  ownerId: string,
  closesOn?: string,
): Promise<ReadonlyMap<string, bigint>> {
  const groups = await client.invoiceSettlement.groupBy({
    _sum: { amountMinorUnits: true },
    by: ['invoiceClosesOn'],
    where: {
      cardId,
      ownerId,
      ...(closesOn === undefined
        ? {}
        : { invoiceClosesOn: civilDateToDate(closesOn) }),
    },
  });
  return new Map(
    groups.map((group) => [
      dateToCivilDate(group.invoiceClosesOn),
      BigInt((group._sum.amountMinorUnits ?? 0).toFixed(0)),
    ]),
  );
}

function view(
  row: PersistedInvoice,
  sums: ReadonlyMap<string, PurchaseSum>,
  settled: ReadonlyMap<string, bigint>,
): CardInvoiceView {
  const invoice = restoreInvoice(row);
  const zero = Money.fromMinorUnits(0n, invoice.currency);
  const sum = sums.get(dateToCivilDate(row.closesOn));
  return {
    invoice,
    purchaseCount: sum?.count ?? 0,
    purchasesTotal: sum?.total ?? zero,
    settledTotal: Money.fromMinorUnits(
      settled.get(dateToCivilDate(row.closesOn)) ?? 0n,
      invoice.currency,
    ),
  };
}

function invoiceCreateData(
  invoice: CardInvoice,
): Prisma.CardInvoiceCreateManyInput {
  const value = invoice.toSnapshot();
  return {
    cardId: value.cardId,
    closedAt: null,
    closedTotalMinorUnits: null,
    closesOn: civilDateToDate(value.closesOn),
    closingBoundary: value.closingBoundary,
    configurationPending: value.configurationPending,
    createdAt: value.createdAt,
    currencyCode: value.currency.code,
    currencyMinorUnitScale: value.currency.minorUnitScale,
    dueOn: civilDateToDate(value.dueOn),
    firstPurchaseDate: civilDateToDate(value.firstPurchaseDate),
    holidayDatasetVersion: value.holidayDatasetVersion,
    id: value.id,
    lastPurchaseDate: civilDateToDate(value.lastPurchaseDate),
    ownerId: value.ownerId,
    scheduledDueOn: civilDateToDate(value.scheduledDueOn),
    status: value.status,
    timeZone: value.timeZone,
    version: value.version,
  };
}

export function restoreInvoice(row: PersistedInvoice): CardInvoice {
  return CardInvoice.restore({
    cardId: row.cardId,
    closedAt: row.closedAt,
    closedTotal:
      row.closedTotalMinorUnits === null
        ? null
        : {
            amount: minorUnitsToDecimal(
              row.closedTotalMinorUnits.toFixed(0),
              row.currencyMinorUnitScale,
            ),
            currency: {
              code: row.currencyCode,
              minorUnitScale: row.currencyMinorUnitScale,
            },
          },
    closesOn: dateToCivilDate(row.closesOn),
    closingBoundary: parseBoundary(row.closingBoundary),
    configurationPending: row.configurationPending,
    createdAt: row.createdAt,
    currency: {
      code: row.currencyCode,
      minorUnitScale: row.currencyMinorUnitScale,
    },
    dueOn: dateToCivilDate(row.dueOn),
    firstPurchaseDate: dateToCivilDate(row.firstPurchaseDate),
    holidayDatasetVersion: row.holidayDatasetVersion,
    id: row.id,
    lastPurchaseDate: dateToCivilDate(row.lastPurchaseDate),
    ownerId: row.ownerId,
    scheduledDueOn: dateToCivilDate(row.scheduledDueOn),
    status: row.status === 'closed' ? 'closed' : 'open',
    timeZone: row.timeZone,
    version: row.version,
  });
}

function parseBoundary(value: string): CardClosingBoundary {
  const boundary = CARD_CLOSING_BOUNDARIES.find(
    (candidate) => candidate === value,
  );
  if (boundary === undefined) throw new Error('Invalid closing boundary.');
  return boundary;
}
