import {
  InvestmentCustodyExceededError,
  InvestmentEventVersionConflictError,
  InvestmentUnavailableForEventError,
  type IdempotencyRequest,
  type InvestmentEventRepository,
  type InvestmentEventWrite,
} from '@seshat/application';
import {
  InvestmentEvent,
  Transaction,
  type InvestmentEventKind,
  type InvestmentEventLifecycle,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import type {
  InvestmentEvent as PersistedEvent,
  PrismaClient,
} from '../generated/prisma/client.js';
import {
  claimIdempotencyKey,
  findActiveIdempotentResponse,
  storeIdempotentResponse,
} from '../idempotency/idempotency-records.js';
import { PrismaTransactionRunner } from '../prisma/prisma-transaction-runner.js';

const MAX_EVENTS = 1000;

type TransactionClient = PrismaTransactionRunner['transactionClient'];

export class PrismaInvestmentEventRepository implements InvestmentEventRepository {
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
    eventId: string,
    ownerId: string,
  ): Promise<InvestmentEvent | null> {
    const row = await this.client.investmentEvent.findFirst({
      where: { id: eventId, ownerId },
    });
    return row === null ? null : restore(row);
  }

  public async listForInvestment(
    investmentId: string,
    ownerId: string,
  ): Promise<readonly InvestmentEvent[]> {
    const rows = await this.client.investmentEvent.findMany({
      orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_EVENTS,
      where: { investmentId, ownerId },
    });
    return rows.map(restore);
  }

  public recordAtomically(
    request: IdempotencyRequest,
    write: InvestmentEventWrite,
    response: string,
  ): Promise<string> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      const investmentId = write.event.investmentId;
      await lockActiveInvestment(client, investmentId, request.ownerId);
      if (write.transaction !== null) {
        await insertEntry(client, write.transaction, write.event);
      }
      const value = write.event.toSnapshot();
      await client.investmentEvent.create({
        data: {
          ...columns(write.event),
          createdAt: value.createdAt,
          id: value.id,
          investmentId: value.investmentId,
          kind: value.kind,
          ownerId: value.ownerId,
        },
      });
      await assertCustody(client, investmentId, request.ownerId);
      for (const event of write.auditEvents) {
        await insertFinancialAuditEvent(client, event);
      }
      await storeIdempotentResponse(client, request, response);
      return response;
    });
  }

  public changeAtomically(
    eventId: string,
    ownerId: string,
    expectedVersion: number,
    build: (
      event: InvestmentEvent,
      transaction: Transaction | null,
    ) => InvestmentEventWrite,
  ): Promise<InvestmentEvent | null> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const found = await client.investmentEvent.findFirst({
        select: { investmentId: true },
        where: { id: eventId, ownerId },
      });
      if (found === null) return null;
      // Same lock order as recording: investment first, then the event.
      await lockActiveInvestment(client, found.investmentId, ownerId);
      await client.$queryRaw`
        SELECT "id" FROM "investment_events"
        WHERE "id" = ${eventId}::uuid AND "owner_id" = ${ownerId}::uuid
        FOR UPDATE
      `;
      const row = await client.investmentEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      if (row.version !== expectedVersion) {
        throw new InvestmentEventVersionConflictError();
      }
      const linked =
        row.transactionId === null
          ? null
          : await readEntry(client, row.transactionId, ownerId);
      const linkedVersion = linked?.toSnapshot().version ?? null;
      const write = build(restore(row), linked);
      const updated = await client.investmentEvent.updateMany({
        data: columns(write.event),
        where: { id: eventId, ownerId, version: expectedVersion },
      });
      if (updated.count !== 1) throw new InvestmentEventVersionConflictError();
      if (write.transaction !== null && linked !== null) {
        const entry = write.transaction.toSnapshot();
        const saved = await client.transaction.updateMany({
          data: {
            lifecycle: entry.lifecycle,
            trashedAt: entry.trashedAt,
            updatedAt: entry.updatedAt,
            version: entry.version,
          },
          where: {
            id: entry.id,
            ownerId,
            version: linkedVersion ?? -1,
          },
        });
        if (saved.count !== 1) throw new InvestmentEventVersionConflictError();
      }
      await assertCustody(client, found.investmentId, ownerId);
      for (const event of write.auditEvents) {
        await insertFinancialAuditEvent(client, event);
      }
      return write.event;
    });
  }
}

/** Serializes every event of one investment and rechecks it is active. */
async function lockActiveInvestment(
  client: TransactionClient,
  investmentId: string,
  ownerId: string,
): Promise<void> {
  const [locked] = await client.$queryRaw<{ lifecycle: string }[]>`
    SELECT "lifecycle" FROM "investments"
    WHERE "id" = ${investmentId}::uuid AND "owner_id" = ${ownerId}::uuid
    FOR UPDATE
  `;
  if (locked?.lifecycle !== 'active') {
    throw new InvestmentUnavailableForEventError();
  }
}

/**
 * Rejects the write when the quantity in custody becomes negative on any
 * date (RN-073). Within one day, aportes count before resgates.
 */
async function assertCustody(
  client: TransactionClient,
  investmentId: string,
  ownerId: string,
): Promise<void> {
  const [result] = await client.$queryRaw<{ lowest: string | null }[]>`
    SELECT MIN("running")::text AS "lowest" FROM (
      SELECT SUM(CASE WHEN "kind" = 'contribution' THEN "quantity"
                      ELSE -"quantity" END)
        OVER (ORDER BY "occurred_on",
                       CASE WHEN "kind" = 'contribution' THEN 0 ELSE 1 END,
                       "created_at", "id") AS "running"
      FROM "investment_events"
      WHERE "investment_id" = ${investmentId}::uuid
        AND "owner_id" = ${ownerId}::uuid
        AND "lifecycle" = 'active'
        AND "quantity" IS NOT NULL
    ) AS "custody"
  `;
  if (result?.lowest?.startsWith('-') === true) {
    throw new InvestmentCustodyExceededError();
  }
}

async function insertEntry(
  client: TransactionClient,
  transaction: Transaction,
  event: InvestmentEvent,
): Promise<void> {
  const entry = transaction.toSnapshot();
  await client.transaction.create({
    data: {
      accountId: entry.accountId,
      amountMinorUnits: transaction.amount.toMinorUnits().toString(),
      archivedAt: entry.archivedAt,
      createdAt: entry.createdAt,
      currencyCode: entry.amount.currency.code,
      currencyMinorUnitScale: entry.amount.currency.minorUnitScale,
      description: entry.description,
      id: entry.id,
      kind: entry.kind,
      lifecycle: entry.lifecycle,
      observations: entry.observations,
      occurredAt: entry.occurredAt,
      ownerId: entry.ownerId,
      timeZone: event.toSnapshot().timeZone,
      trashedAt: entry.trashedAt,
      updatedAt: entry.updatedAt,
      version: entry.version,
    },
  });
}

async function readEntry(
  client: TransactionClient,
  transactionId: string,
  ownerId: string,
): Promise<Transaction> {
  const row = await client.transaction.findFirstOrThrow({
    where: { id: transactionId, ownerId },
  });
  return Transaction.restore({
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
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    description: row.description,
    id: row.id,
    kind: row.kind,
    lifecycle: row.lifecycle,
    observations: row.observations,
    occurredAt: row.occurredAt,
    ownerId: row.ownerId,
    trashedAt: row.trashedAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

type EventColumns = Omit<
  PersistedEvent,
  | 'amountMinorUnits'
  | 'createdAt'
  | 'id'
  | 'investmentId'
  | 'kind'
  | 'ownerId'
  | 'quantity'
  | 'unitPrice'
> &
  Readonly<{
    amountMinorUnits: string;
    quantity: string | null;
    unitPrice: string | null;
  }>;

function columns(event: InvestmentEvent): EventColumns {
  const value = event.toSnapshot();
  return {
    accountId: value.accountId,
    amountMinorUnits: event.amount.toMinorUnits().toString(),
    currencyCode: value.amount.currency.code,
    currencyMinorUnitScale: value.amount.currency.minorUnitScale,
    lifecycle: value.lifecycle,
    note: value.note,
    occurredAt: value.occurredAt,
    occurredOn: new Date(`${value.occurredOn}T00:00:00.000Z`),
    quantity: value.quantity,
    timeZone: value.timeZone,
    transactionId: value.transactionId,
    unitPrice: value.unitPrice,
    updatedAt: value.updatedAt,
    version: value.version,
  };
}

function restore(row: PersistedEvent): InvestmentEvent {
  return InvestmentEvent.restore({
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
    createdAt: row.createdAt,
    id: row.id,
    investmentId: row.investmentId,
    kind: row.kind as InvestmentEventKind,
    lifecycle: row.lifecycle as InvestmentEventLifecycle,
    note: row.note,
    occurredAt: row.occurredAt,
    occurredOn: row.occurredOn.toISOString().slice(0, 10),
    ownerId: row.ownerId,
    quantity:
      row.quantity === null ? null : plainDecimal(row.quantity.toFixed()),
    timeZone: row.timeZone,
    transactionId: row.transactionId,
    unitPrice:
      row.unitPrice === null ? null : plainDecimal(row.unitPrice.toFixed()),
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

/** Removes the trailing zeros PostgreSQL keeps for DECIMAL(38, 8). */
function plainDecimal(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/u, '') : value;
}

function minorUnitsToDecimal(minorUnits: string, scale: number): string {
  if (scale === 0) return minorUnits;
  const negative = minorUnits.startsWith('-');
  const digits = (negative ? minorUnits.slice(1) : minorUnits).padStart(
    scale + 1,
    '0',
  );
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}
