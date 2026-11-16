import type {
  IdempotencyRequest,
  LoanEventWrite,
  LoanRecord,
  LoanRenegotiationWrite,
  LoanRepository,
} from '@seshat/application';
import {
  InterestRate,
  Loan,
  Money,
  type FinancialAuditEvent,
  type LoanAllocationComponent,
  type LoanAmortizationProfile,
  type LoanBusinessDayRule,
  type LoanDirection,
  type LoanEvent,
  type LoanExcessClassification,
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

type QueryClient = PrismaClient | Prisma.TransactionClient;

const loanInclude = {
  events: { orderBy: { sequence: 'asc' } },
  installments: { orderBy: { number: 'asc' } },
} as const satisfies Prisma.LoanInclude;

type PersistedLoan = Prisma.LoanGetPayload<{ include: typeof loanInclude }>;

const MAX_LOANS = 200;

export class PrismaLoanRepository implements LoanRepository {
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

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<LoanRecord | null> {
    const row = await this.client.loan.findFirst({
      include: loanInclude,
      where: { id, ownerId },
    });
    return row === null ? null : restore(row);
  }

  public async listForOwner(ownerId: string): Promise<readonly LoanRecord[]> {
    const rows = await this.client.loan.findMany({
      include: loanInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: MAX_LOANS,
      where: { ownerId },
    });
    return rows.map(restore);
  }

  public insertAtomically(
    request: IdempotencyRequest,
    loan: Loan,
    auditEvent: FinancialAuditEvent,
    response: string,
  ): Promise<string> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      await insertLoan(client, loan);
      await insertFinancialAuditEvent(client, auditEvent);
      await storeIdempotentResponse(client, request, response);
      return response;
    });
  }

  public appendEventAtomically(
    request: IdempotencyRequest,
    loanId: string,
    ownerId: string,
    build: (record: LoanRecord) => LoanEventWrite,
  ): Promise<string | null> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      const record = await lockLoan(client, loanId, ownerId);
      if (record === null) return null;
      const write = build(record);
      await insertEvent(client, record, write.event);
      await insertFinancialAuditEvent(client, write.auditEvent);
      await storeIdempotentResponse(client, request, write.response);
      return write.response;
    });
  }

  public renegotiateAtomically(
    request: IdempotencyRequest,
    loanId: string,
    ownerId: string,
    build: (record: LoanRecord) => LoanRenegotiationWrite,
  ): Promise<string | null> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      const record = await lockLoan(client, loanId, ownerId);
      if (record === null) return null;
      const write = build(record);
      await insertLoan(client, write.loan);
      await insertEvent(client, record, write.event);
      for (const auditEvent of write.auditEvents) {
        await insertFinancialAuditEvent(client, auditEvent);
      }
      await storeIdempotentResponse(client, request, write.response);
      return write.response;
    });
  }
}

/** Serializes every event of a loan behind its row lock. */
async function lockLoan(
  client: Prisma.TransactionClient,
  loanId: string,
  ownerId: string,
): Promise<LoanRecord | null> {
  const [locked] = await client.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "loans"
    WHERE "id" = ${loanId}::uuid AND "owner_id" = ${ownerId}::uuid
    FOR UPDATE
  `;
  if (locked === undefined) return null;
  const row = await client.loan.findUniqueOrThrow({
    include: loanInclude,
    where: { id: locked.id },
  });
  return restore(row);
}

async function insertLoan(client: QueryClient, loan: Loan): Promise<void> {
  const value = loan.toSnapshot();
  await client.loan.create({
    data: {
      allocationOrder: [...value.allocationOrder],
      businessDayRule: value.businessDayRule,
      calculationVersion: value.calculationVersion,
      contractedOn: civilDateToDate(value.contractedOn),
      counterpartyId: value.counterpartyId,
      createdAt: value.createdAt,
      currencyCode: value.principal.currency.code,
      currencyMinorUnitScale: value.principal.currency.minorUnitScale,
      declaredAmounts:
        value.declaredAmounts === null ? [] : [...value.declaredAmounts],
      description: value.description,
      direction: value.direction,
      firstDueOn: civilDateToDate(value.firstDueOn),
      id: value.id,
      installmentCount: value.count,
      lateFeePercent: value.lateFeePercent,
      ownerId: value.ownerId,
      principalMinorUnits: units(value.principal),
      profile: value.profile,
      rateMethod: value.rate?.method ?? null,
      ratePercentPerPeriod: value.rate?.percentPerPeriod ?? null,
      ratePeriodicity: value.rate?.periodicity ?? null,
      renegotiatedFromId: value.renegotiatedFromId,
    },
  });
  await client.loanInstallment.createMany({
    data: value.installments.map((item) => ({
      amountMinorUnits: units(item.amount),
      dueOn: civilDateToDate(item.dueOn),
      interestMinorUnits: units(item.interest),
      loanId: value.id,
      number: item.number,
      ownerId: value.ownerId,
      principalMinorUnits: units(item.principal),
      scheduledDueOn: civilDateToDate(item.scheduledDueOn),
    })),
  });
}

async function insertEvent(
  client: QueryClient,
  record: LoanRecord,
  event: LoanEvent,
): Promise<void> {
  const base = {
    id: event.id,
    kind: event.kind,
    loanId: record.loan.id,
    ownerId: record.loan.ownerId,
    recordedAt: event.recordedAt,
    sequence: record.events.length + 1,
  };
  if (event.kind === 'reversal') {
    await client.loanEvent.create({
      data: {
        ...base,
        reason: event.reason,
        reversedEventId: event.reversedEventId,
      },
    });
    return;
  }
  if (event.kind === 'renegotiation') {
    await client.loanEvent.create({
      data: {
        ...base,
        newLoanId: event.newLoanId,
        occurredOn: civilDateToDate(event.occurredOn),
      },
    });
    return;
  }
  if (event.kind === 'prepayment') {
    await client.loanEvent.create({
      data: {
        ...base,
        amountMinorUnits: units(event.amount),
        discountMinorUnits: units(event.discount),
        occurredOn: civilDateToDate(event.occurredOn),
      },
    });
    return;
  }
  await client.loanEvent.create({
    data: {
      ...base,
      allocationOrder:
        event.allocationOrder === null ? [] : [...event.allocationOrder],
      amountMinorUnits: units(event.amount),
      declaredFeeMinorUnits:
        event.declaredFee === null ? null : units(event.declaredFee),
      excess: event.excess,
      occurredOn: civilDateToDate(event.occurredOn),
    },
  });
}

function restore(row: PersistedLoan): LoanRecord {
  const code = row.currencyCode;
  const scale = row.currencyMinorUnitScale;
  const money = (value: Prisma.Decimal): MoneySnapshot => ({
    amount: minorUnitsToDecimal(value.toFixed(0), scale),
    currency: { code, minorUnitScale: scale },
  });
  const loan = Loan.restore({
    allocationOrder: row.allocationOrder as LoanAllocationComponent[],
    businessDayRule: row.businessDayRule as LoanBusinessDayRule,
    calculationVersion: row.calculationVersion,
    contractedOn: dateToCivilDate(row.contractedOn),
    count: row.installmentCount,
    counterpartyId: row.counterpartyId,
    createdAt: row.createdAt,
    declaredAmounts: row.profile === 'declared' ? row.declaredAmounts : null,
    description: row.description,
    direction: row.direction as LoanDirection,
    firstDueOn: dateToCivilDate(row.firstDueOn),
    id: row.id,
    installments: row.installments.map((item) => ({
      amount: money(item.amountMinorUnits),
      dueOn: dateToCivilDate(item.dueOn),
      interest: money(item.interestMinorUnits),
      number: item.number,
      principal: money(item.principalMinorUnits),
      scheduledDueOn: dateToCivilDate(item.scheduledDueOn),
    })),
    lateFeePercent: row.lateFeePercent,
    ownerId: row.ownerId,
    principal: money(row.principalMinorUnits),
    profile: row.profile as LoanAmortizationProfile,
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
  });
  const events = row.events.map((item): LoanEvent => {
    const required = (value: Prisma.Decimal | null): MoneySnapshot => {
      if (value === null) throw new Error('Stored loan event is incomplete.');
      return money(value);
    };
    const on = item.occurredOn === null ? '' : dateToCivilDate(item.occurredOn);
    if (item.kind === 'reversal') {
      return {
        id: item.id,
        kind: 'reversal',
        reason: item.reason ?? '',
        recordedAt: item.recordedAt,
        reversedEventId: item.reversedEventId ?? '',
      };
    }
    if (item.kind === 'renegotiation') {
      return {
        id: item.id,
        kind: 'renegotiation',
        newLoanId: item.newLoanId ?? '',
        occurredOn: on,
        recordedAt: item.recordedAt,
      };
    }
    if (item.kind === 'prepayment') {
      return {
        amount: required(item.amountMinorUnits),
        discount: required(item.discountMinorUnits),
        id: item.id,
        kind: 'prepayment',
        occurredOn: on,
        recordedAt: item.recordedAt,
      };
    }
    return {
      allocationOrder:
        item.allocationOrder.length === 0
          ? null
          : (item.allocationOrder as LoanAllocationComponent[]),
      amount: required(item.amountMinorUnits),
      declaredFee:
        item.declaredFeeMinorUnits === null
          ? null
          : money(item.declaredFeeMinorUnits),
      excess: item.excess as LoanExcessClassification | null,
      id: item.id,
      kind: 'payment',
      occurredOn: on,
      recordedAt: item.recordedAt,
    };
  });
  return { events, loan };
}

function units(value: MoneySnapshot): string {
  return Money.restore(value).toMinorUnits().toString();
}

/** DATE columns travel as UTC midnight; the civil value is the UTC date. */
function civilDateToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateToCivilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Exact decimal string from integer minor units, without floating point. */
function minorUnitsToDecimal(value: string, scale: number): string {
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).padStart(scale + 1, '0');
  const amount =
    scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${amount}` : amount;
}
