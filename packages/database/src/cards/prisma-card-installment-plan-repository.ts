import {
  CardInstallmentInvoiceClosedError,
  type CardInstallmentPlanChangeRepository,
  type CardPlanChangeWrite,
  type CardPlanRecord,
  type CardInvoiceInstallment,
  type CardInvoiceInstallmentReader,
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
  type CardPlanChange,
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
  changes: { orderBy: { sequence: 'asc' } },
  installments: { orderBy: { number: 'asc' } },
} as const satisfies Prisma.CardInstallmentPlanInclude;

type PersistedPlan = Prisma.CardInstallmentPlanGetPayload<{
  include: typeof planInclude;
}>;

export class PrismaCardInstallmentPlanRepository
  implements
    CardInstallmentPlanRepository,
    CardInvoiceInstallmentReader,
    CardInstallmentPlanChangeRepository
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

  public async listForCycle(
    cardId: string,
    cycleClosesOn: string,
    ownerId: string,
  ): Promise<readonly CardInvoiceInstallment[]> {
    const cycle = civilDateToDate(cycleClosesOn);
    const plans = await this.client.cardInstallmentPlan.findMany({
      include: {
        changes: { orderBy: { sequence: 'asc' } },
        installments: {
          orderBy: { number: 'asc' },
          where: { cycleClosesOn: cycle },
        },
        purchase: { select: { description: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: { cardId, ownerId },
    });
    const lines: CardInvoiceInstallment[] = [];
    for (const plan of plans) {
      const scale = plan.currencyMinorUnitScale;
      const at = (value: Prisma.Decimal): Money =>
        Money.restore(money(value, plan.currencyCode, scale));
      const reversed = new Set(
        plan.changes
          .filter((change) => change.kind === 'reversal')
          .map((change) => change.reversedChangeId),
      );
      const closing = plan.changes.find(
        (change) => change.kind !== 'reversal' && !reversed.has(change.id),
      );
      for (const row of plan.installments) {
        // Prepaid or renegotiated installments left this cycle (US-046).
        if (
          closing?.effectiveCycleClosesOn != null &&
          row.cycleClosesOn > closing.effectiveCycleClosesOn
        ) {
          continue;
        }
        lines.push({
          amount: at(row.amountMinorUnits),
          count: plan.installmentCount,
          description: plan.purchase.description,
          interest: at(row.interestMinorUnits),
          kind: 'installment',
          number: row.number,
          planId: plan.id,
          principal: at(row.principalMinorUnits),
          purchaseId: plan.purchaseId,
        });
      }
      if (
        closing?.kind === 'prepayment' &&
        closing.amountMinorUnits !== null &&
        closing.effectiveCycleClosesOn?.getTime() === cycle.getTime()
      ) {
        lines.push({
          amount: at(closing.amountMinorUnits),
          count: plan.installmentCount,
          description: plan.purchase.description,
          interest: Money.fromMinorUnits(
            0n,
            at(closing.amountMinorUnits).currency,
          ),
          kind: 'prepayment',
          number: 0,
          planId: plan.id,
          principal: at(closing.amountMinorUnits),
          purchaseId: plan.purchaseId,
        });
      }
    }
    return lines;
  }

  public async findChainForPurchase(
    purchaseId: string,
    ownerId: string,
  ): Promise<readonly CardPlanRecord[]> {
    return chain(this.client, purchaseId, ownerId);
  }

  public changeAtomically(
    request: IdempotencyRequest,
    planId: string,
    ownerId: string,
    referenceInvoice: CardInvoice,
    build: (record: CardPlanRecord) => CardPlanChangeWrite,
  ): Promise<string> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      if ((await lockOrFormInvoice(client, referenceInvoice)) === 'closed') {
        throw new CardInstallmentInvoiceClosedError();
      }
      const [locked] = await client.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "card_installment_plans"
        WHERE "id" = ${planId}::uuid AND "owner_id" = ${ownerId}::uuid
        FOR UPDATE
      `;
      if (locked === undefined) throw new Error('Installment plan not found.');
      const row = await client.cardInstallmentPlan.findUniqueOrThrow({
        include: planInclude,
        where: { id: locked.id },
      });
      const record = { changes: restoreChanges(row), plan: restorePlan(row) };
      const write = build(record);
      if (write.newPlan !== null) {
        for (const invoice of write.newPlan.invoices) {
          if ((await lockOrFormInvoice(client, invoice)) === 'closed') {
            throw new CardInstallmentInvoiceClosedError();
          }
        }
        await insertPlan(client, write.newPlan.plan);
      }
      await insertChange(client, record, write.change);
      // Invoices that lost installments must still cover their settlements.
      const reference = referenceInvoice.closesOn.toString();
      for (const item of record.plan.toSnapshot().installments) {
        if (item.cycleClosesOn > reference) {
          await assertSettlementsFit(
            client,
            record.plan.cardId,
            ownerId,
            item.cycleClosesOn,
          );
        }
      }
      for (const auditEvent of write.auditEvents) {
        await insertFinancialAuditEvent(client, auditEvent);
      }
      await storeIdempotentResponse(client, request, write.response);
      return write.response;
    });
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

      await insertPlan(client, write.plan);

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

async function insertPlan(
  client: QueryClient,
  plan: CardInstallmentPlan,
): Promise<void> {
  const snapshot = plan.toSnapshot();
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
      renegotiatedFromId: snapshot.renegotiatedFromId,
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
}

async function chain(
  client: QueryClient,
  purchaseId: string,
  ownerId: string,
): Promise<readonly CardPlanRecord[]> {
  const rows = await client.cardInstallmentPlan.findMany({
    include: planInclude,
    where: { ownerId, purchaseId },
  });
  const records: CardPlanRecord[] = [];
  let parent: string | null = null;
  for (;;) {
    const next = rows.find((row) => row.renegotiatedFromId === parent);
    if (next === undefined) break;
    records.push({ changes: restoreChanges(next), plan: restorePlan(next) });
    parent = next.id;
  }
  return records;
}

async function insertChange(
  client: QueryClient,
  record: CardPlanRecord,
  change: CardPlanChange,
): Promise<void> {
  const base = {
    id: change.id,
    kind: change.kind,
    ownerId: record.plan.ownerId,
    planId: record.plan.id,
    recordedAt: change.recordedAt,
    sequence: record.changes.length + 1,
  };
  if (change.kind === 'reversal') {
    await client.cardInstallmentPlanChange.create({
      data: {
        ...base,
        reason: change.reason,
        reversedChangeId: change.reversedChangeId,
      },
    });
    return;
  }
  if (change.kind === 'renegotiation') {
    await client.cardInstallmentPlanChange.create({
      data: {
        ...base,
        effectiveCycleClosesOn: civilDateToDate(change.effectiveCycleClosesOn),
        newPlanId: change.newPlanId,
      },
    });
    return;
  }
  await client.cardInstallmentPlanChange.create({
    data: {
      ...base,
      amountMinorUnits: units(change.amount),
      discountMinorUnits: units(change.discount),
      effectiveCycleClosesOn: civilDateToDate(change.effectiveCycleClosesOn),
    },
  });
}

async function assertSettlementsFit(
  client: QueryClient,
  cardId: string,
  ownerId: string,
  cycleClosesOn: string,
): Promise<void> {
  const date = civilDateToDate(cycleClosesOn);
  const [charges, settled] = await Promise.all([
    cycleChargeSums(client, cardId, ownerId, date),
    client.invoiceSettlement.aggregate({
      _sum: { amountMinorUnits: true },
      where: { cardId, invoiceClosesOn: date, ownerId },
    }),
  ]);
  const obligation = charges.get(cycleClosesOn)?.total.toMinorUnits() ?? 0n;
  if (BigInt((settled._sum.amountMinorUnits ?? 0).toFixed(0)) > obligation) {
    throw new CardInstallmentSettledAboveObligationError();
  }
}

function restoreChanges(row: PersistedPlan): readonly CardPlanChange[] {
  const code = row.currencyCode;
  const scale = row.currencyMinorUnitScale;
  return row.changes.map((item): CardPlanChange => {
    const on =
      item.effectiveCycleClosesOn === null
        ? ''
        : dateToCivilDate(item.effectiveCycleClosesOn);
    if (item.kind === 'reversal') {
      return {
        id: item.id,
        kind: 'reversal',
        reason: item.reason ?? '',
        recordedAt: item.recordedAt,
        reversedChangeId: item.reversedChangeId ?? '',
      };
    }
    if (item.kind === 'renegotiation') {
      return {
        effectiveCycleClosesOn: on,
        id: item.id,
        kind: 'renegotiation',
        newPlanId: item.newPlanId ?? '',
        recordedAt: item.recordedAt,
      };
    }
    if (item.amountMinorUnits === null || item.discountMinorUnits === null) {
      throw new Error('Stored prepayment is incomplete.');
    }
    return {
      amount: money(item.amountMinorUnits, code, scale),
      discount: money(item.discountMinorUnits, code, scale),
      effectiveCycleClosesOn: on,
      id: item.id,
      kind: 'prepayment',
      recordedAt: item.recordedAt,
    };
  });
}

async function findPlan(
  client: QueryClient,
  purchaseId: string,
  ownerId: string,
): Promise<CardInstallmentPlan | null> {
  const row = await client.cardInstallmentPlan.findFirst({
    include: planInclude,
    where: { ownerId, purchaseId, renegotiatedFromId: null },
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
    renegotiatedFromId: row.renegotiatedFromId,
    status: 'active',
    total: money(row.totalMinorUnits, code, scale),
  });
}
