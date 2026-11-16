import {
  CardInstallmentInvoiceClosedError,
  CardInstallmentSettledAboveObligationError,
  CardPurchaseAlreadyInstalledError,
  type CardInstallmentPlanRepository,
  type CardInstallmentPlanWrite,
  type IdempotencyRequest,
} from '@seshat/application';
import {
  CardInstallmentPlan,
  InterestRate,
  Money,
  type CardInvoice,
  type CardPurchase,
  type MoneySnapshot,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  claimIdempotencyKey,
  findActiveIdempotentResponse,
  storeIdempotentResponse,
} from '../idempotency/idempotency-records.js';
import { PrismaTransactionRunner } from '../prisma/prisma-transaction-runner.js';
import { cycleChargeSums } from './card-cycle-charges.js';
import { lockOrFormInvoice } from './prisma-card-invoice-repository.js';
import {
  civilDateToDate,
  dateToCivilDate,
  minorUnitsToDecimal,
  restorePurchase,
} from './prisma-card-purchase-repository.js';

type QueryClient = PrismaClient | Prisma.TransactionClient;

const planInclude = {
  installments: { orderBy: { number: 'asc' } },
} as const satisfies Prisma.CardInstallmentPlanInclude;

type PersistedPlan = Prisma.CardInstallmentPlanGetPayload<{
  include: typeof planInclude;
}>;

export class PrismaCardInstallmentPlanRepository implements CardInstallmentPlanRepository {
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

  public async findPurchaseForOwner(
    purchaseId: string,
    ownerId: string,
  ): Promise<CardPurchase | null> {
    const row = await this.client.cardPurchase.findFirst({
      where: { id: purchaseId, ownerId },
    });
    return row === null ? null : restorePurchase(row);
  }

  public findPlanForPurchase(
    purchaseId: string,
    ownerId: string,
  ): Promise<CardInstallmentPlan | null> {
    return findPlan(this.client, purchaseId, ownerId);
  }

  public async insertAtomically(
    request: IdempotencyRequest,
    invoices: readonly CardInvoice[],
    write: CardInstallmentPlanWrite,
  ): Promise<string> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;

      // Same lock order as purchases, closing and settlements: by cycle.
      for (const invoice of invoices) {
        if ((await lockOrFormInvoice(client, invoice)) === 'closed') {
          throw new CardInstallmentInvoiceClosedError();
        }
      }
      const snapshot = write.plan.toSnapshot();
      if (
        (await findPlan(client, snapshot.purchaseId, snapshot.ownerId)) !== null
      ) {
        throw new CardPurchaseAlreadyInstalledError();
      }

      await client.cardInstallmentPlan.create({
        data: {
          calculationVersion: snapshot.calculationVersion,
          cardId: snapshot.cardId,
          createdAt: snapshot.createdAt,
          currencyCode: snapshot.total.currency.code,
          currencyMinorUnitScale: snapshot.total.currency.minorUnitScale,
          id: snapshot.id,
          installmentCount: snapshot.count,
          interestMinorUnits: units(snapshot.interest),
          ownerId: snapshot.ownerId,
          principalMinorUnits: units(snapshot.principal),
          purchaseId: snapshot.purchaseId,
          rateMethod: snapshot.rate?.method ?? null,
          ratePercentPerPeriod: snapshot.rate?.percentPerPeriod ?? null,
          ratePeriodicity: snapshot.rate?.periodicity ?? null,
          status: snapshot.status,
          totalMinorUnits: units(snapshot.total),
        },
      });
      await client.cardInstallment.createMany({
        data: snapshot.installments.map((installment) => ({
          amountMinorUnits: units(installment.amount),
          cardId: snapshot.cardId,
          currencyCode: installment.amount.currency.code,
          currencyMinorUnitScale: installment.amount.currency.minorUnitScale,
          cycleClosesOn: civilDateToDate(installment.cycleClosesOn),
          id: installment.id,
          interestMinorUnits: units(installment.interest),
          number: installment.number,
          ownerId: snapshot.ownerId,
          planId: snapshot.id,
          principalMinorUnits: units(installment.principal),
        })),
      });

      // The purchase invoice loses the purchase and gains installment 1;
      // settlements already declared there must still fit (INV-018).
      const first = write.plan.firstCycleClosesOn.toString();
      const firstDate = civilDateToDate(first);
      const [charges, settled] = await Promise.all([
        cycleChargeSums(client, snapshot.cardId, snapshot.ownerId, firstDate),
        client.invoiceSettlement.aggregate({
          _sum: { amountMinorUnits: true },
          where: {
            cardId: snapshot.cardId,
            invoiceClosesOn: firstDate,
            ownerId: snapshot.ownerId,
          },
        }),
      ]);
      const obligation = charges.get(first)?.total.toMinorUnits() ?? 0n;
      if (
        BigInt((settled._sum.amountMinorUnits ?? 0).toFixed(0)) > obligation
      ) {
        throw new CardInstallmentSettledAboveObligationError();
      }

      await insertFinancialAuditEvent(client, write.auditEvent);
      await storeIdempotentResponse(client, request, write.response);
      return write.response;
    });
  }
}

async function findPlan(
  client: QueryClient,
  purchaseId: string,
  ownerId: string,
): Promise<CardInstallmentPlan | null> {
  const row = await client.cardInstallmentPlan.findFirst({
    include: planInclude,
    where: { ownerId, purchaseId },
  });
  return row === null ? null : restorePlan(row);
}

function units(value: MoneySnapshot): string {
  return Money.restore(value).toMinorUnits().toString();
}

function money(
  value: Prisma.Decimal,
  currencyCode: string,
  scale: number,
): MoneySnapshot {
  return {
    amount: minorUnitsToDecimal(value.toFixed(0), scale),
    currency: { code: currencyCode, minorUnitScale: scale },
  };
}

function restorePlan(row: PersistedPlan): CardInstallmentPlan {
  const scale = row.currencyMinorUnitScale;
  const code = row.currencyCode;
  return CardInstallmentPlan.restore({
    calculationVersion: row.calculationVersion,
    cardId: row.cardId,
    count: row.installmentCount,
    createdAt: row.createdAt,
    id: row.id,
    installments: row.installments.map((item) => ({
      amount: money(item.amountMinorUnits, code, scale),
      cycleClosesOn: dateToCivilDate(item.cycleClosesOn),
      id: item.id,
      interest: money(item.interestMinorUnits, code, scale),
      number: item.number,
      principal: money(item.principalMinorUnits, code, scale),
    })),
    interest: money(row.interestMinorUnits, code, scale),
    ownerId: row.ownerId,
    principal: money(row.principalMinorUnits, code, scale),
    purchaseId: row.purchaseId,
    rate:
      row.rateMethod === null ||
      row.ratePercentPerPeriod === null ||
      row.ratePeriodicity === null
        ? null
        : InterestRate.create({
            method: row.rateMethod,
            percentPerPeriod: row.ratePercentPerPeriod,
            periodicity: row.ratePeriodicity,
          }).toSnapshot(),
    status: 'active',
    total: money(row.totalMinorUnits, code, scale),
  });
}
