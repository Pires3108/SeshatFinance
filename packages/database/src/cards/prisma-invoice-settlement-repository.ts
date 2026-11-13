import {
  InvoiceSettlementExceedsRemainingError,
  type IdempotencyRequest,
  type InvoiceSettlementReader,
  type InvoiceSettlementRepository,
  type InvoiceSettlementWrite,
} from '@seshat/application';
import { InvoiceSettlement } from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import {
  claimIdempotencyKey,
  findActiveIdempotentResponse,
  storeIdempotentResponse,
} from '../idempotency/idempotency-records.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaTransactionRunner } from '../prisma/prisma-transaction-runner.js';
import {
  civilDateToDate,
  dateToCivilDate,
  minorUnitsToDecimal,
} from './prisma-card-purchase-repository.js';

export class PrismaInvoiceSettlementRepository
  implements InvoiceSettlementRepository, InvoiceSettlementReader
{
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

  public async settleAtomically(
    request: IdempotencyRequest,
    cardId: string,
    invoiceClosesOn: string,
    write: InvoiceSettlementWrite,
  ): Promise<string | null> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      const closesOn = civilDateToDate(invoiceClosesOn);
      // Serializes settlements, purchases and closing of this invoice.
      const [invoice] = await client.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "card_invoices"
        WHERE "owner_id" = ${request.ownerId}::uuid
          AND "card_id" = ${cardId}::uuid
          AND "closes_on" = ${closesOn}::date
        FOR UPDATE
      `;
      if (invoice === undefined) return null;
      const [purchases, settled] = await Promise.all([
        client.cardPurchase.aggregate({
          _sum: { amountMinorUnits: true },
          where: { cardId, cycleClosesOn: closesOn, ownerId: request.ownerId },
        }),
        client.invoiceSettlement.aggregate({
          _sum: { amountMinorUnits: true },
          where: {
            cardId,
            invoiceClosesOn: closesOn,
            ownerId: request.ownerId,
          },
        }),
      ]);
      const remaining =
        BigInt((purchases._sum.amountMinorUnits ?? 0).toFixed(0)) -
        BigInt((settled._sum.amountMinorUnits ?? 0).toFixed(0));
      const amount = write.settlement.amount.toMinorUnits();
      if (amount > remaining)
        throw new InvoiceSettlementExceedsRemainingError();

      const movement = write.transaction.toSnapshot();
      await client.transaction.create({
        data: {
          accountId: movement.accountId,
          amountMinorUnits: write.transaction.amount.toMinorUnits().toString(),
          archivedAt: movement.archivedAt,
          createdAt: movement.createdAt,
          currencyCode: movement.amount.currency.code,
          currencyMinorUnitScale: movement.amount.currency.minorUnitScale,
          description: movement.description,
          id: movement.id,
          kind: movement.kind,
          lifecycle: movement.lifecycle,
          observations: movement.observations,
          occurredAt: movement.occurredAt,
          ownerId: movement.ownerId,
          trashedAt: movement.trashedAt,
          updatedAt: movement.updatedAt,
          version: movement.version,
        },
      });
      const value = write.settlement.toSnapshot();
      await client.invoiceSettlement.create({
        data: {
          accountId: value.accountId,
          amountMinorUnits: amount.toString(),
          cardId: value.cardId,
          createdAt: value.createdAt,
          currencyCode: value.amount.currency.code,
          currencyMinorUnitScale: value.amount.currency.minorUnitScale,
          id: value.id,
          invoiceClosesOn: civilDateToDate(value.invoiceClosesOn),
          ownerId: value.ownerId,
          paidAt: value.paidAt,
          transactionId: value.transactionId,
        },
      });
      for (const event of write.auditEvents) {
        await insertFinancialAuditEvent(client, event);
      }
      await storeIdempotentResponse(client, request, write.response);
      return write.response;
    });
  }

  public async listForInvoice(
    cardId: string,
    invoiceClosesOn: string,
    ownerId: string,
  ): Promise<readonly InvoiceSettlement[]> {
    const rows = await this.client.invoiceSettlement.findMany({
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
      take: 200,
      where: {
        cardId,
        invoiceClosesOn: civilDateToDate(invoiceClosesOn),
        ownerId,
      },
    });
    return rows.map((row) =>
      InvoiceSettlement.restore({
        accountId: row.accountId,
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
        createdAt: row.createdAt,
        id: row.id,
        invoiceClosesOn: dateToCivilDate(row.invoiceClosesOn),
        ownerId: row.ownerId,
        paidAt: row.paidAt,
        transactionId: row.transactionId,
      }),
    );
  }
}
