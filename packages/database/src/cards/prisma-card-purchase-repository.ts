import type {
  CardPurchaseRepository,
  CardPurchaseWrite,
  IdempotencyRequest,
} from '@seshat/application';
import { CardPurchase, type CardInvoice } from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import {
  claimIdempotencyKey,
  findActiveIdempotentResponse,
  storeIdempotentResponse,
} from '../idempotency/idempotency-records.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaTransactionRunner } from '../prisma/prisma-transaction-runner.js';
import { lockOrFormInvoice } from './prisma-card-invoice-repository.js';

const MAX_PURCHASES = 500;

export class PrismaCardPurchaseRepository implements CardPurchaseRepository {
  private readonly transactions: PrismaTransactionRunner;

  public constructor(
    private readonly client: PrismaClient,
    transactions?: PrismaTransactionRunner,
  ) {
    this.transactions = transactions ?? new PrismaTransactionRunner(client);
  }

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return findActiveIdempotentResponse(this.client, request);
  }

  public async insertAtomically(
    request: IdempotencyRequest,
    candidates: readonly CardInvoice[],
    build: (
      invoice: CardInvoice,
      postedAfterClose: boolean,
    ) => CardPurchaseWrite,
  ): Promise<string> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      let index = -1;
      for (const [position, candidate] of candidates.entries()) {
        if ((await lockOrFormInvoice(client, candidate)) === 'open') {
          index = position;
          break;
        }
      }
      const invoice = candidates[index];
      if (invoice === undefined) {
        throw new Error('No open card invoice within the routing window.');
      }
      const write = build(invoice, index > 0);
      const snapshot = write.purchase.toSnapshot();
      await client.cardPurchase.create({
        data: {
          amountMinorUnits: write.purchase.amount.toMinorUnits().toString(),
          cardId: snapshot.cardId,
          categoryId: snapshot.categoryId,
          createdAt: snapshot.createdAt,
          currencyCode: snapshot.amount.currency.code,
          currencyMinorUnitScale: snapshot.amount.currency.minorUnitScale,
          cycleClosesOn: civilDateToDate(snapshot.cycleClosesOn),
          description: snapshot.description,
          externalId: snapshot.externalId,
          id: snapshot.id,
          occurredAt: snapshot.occurredAt,
          ownerId: snapshot.ownerId,
          postedAfterClose: snapshot.postedAfterClose,
        },
      });
      await insertFinancialAuditEvent(client, write.auditEvent);
      await storeIdempotentResponse(client, request, write.response);
      return write.response;
    });
  }

  public async listForCard(
    cardId: string,
    ownerId: string,
    cycleClosesOn?: string,
  ): Promise<readonly CardPurchase[]> {
    const rows = await this.client.cardPurchase.findMany({
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: MAX_PURCHASES,
      where: {
        cardId,
        ownerId,
        ...(cycleClosesOn === undefined
          ? {}
          : { cycleClosesOn: civilDateToDate(cycleClosesOn) }),
      },
    });
    return rows.map(restorePurchase);
  }
}

type PersistedPurchase = NonNullable<
  Awaited<ReturnType<PrismaClient['cardPurchase']['findFirst']>>
>;

/** DATE columns travel as UTC midnight; the civil value is the UTC date. */
export function civilDateToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dateToCivilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Exact decimal string from integer minor units, without floating point. */
export function minorUnitsToDecimal(value: string, scale: number): string {
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).padStart(scale + 1, '0');
  const amount =
    scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${amount}` : amount;
}

function restorePurchase(row: PersistedPurchase): CardPurchase {
  return CardPurchase.restore({
    amount: {
      amount: minorUnitsToDecimal(
        row.amountMinorUnits.toFixed(0),
        row.currencyMinorUnitScale,
      ),
      currency: {
        code: row.currencyCode,
        minorUnitScale: row.currencyMinorUnitScale,
      },
    },
    cardId: row.cardId,
    categoryId: row.categoryId,
    createdAt: row.createdAt,
    cycleClosesOn: dateToCivilDate(row.cycleClosesOn),
    description: row.description,
    externalId: row.externalId,
    id: row.id,
    occurredAt: row.occurredAt,
    ownerId: row.ownerId,
    postedAfterClose: row.postedAfterClose,
  });
}
