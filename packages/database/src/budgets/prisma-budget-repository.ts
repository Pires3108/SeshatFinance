import {
  BudgetOverlapError,
  BudgetVersionConflictError,
  type BudgetRepository,
  type BudgetWrite,
  type IdempotencyRequest,
} from '@seshat/application';
import {
  Budget,
  Currency,
  Money,
  type BudgetDimensionKind,
  type BudgetLifecycle,
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

const budgetInclude = {
  limits: { orderBy: { effectiveFrom: 'asc' } },
} as const satisfies Prisma.BudgetInclude;

type PersistedBudget = Prisma.BudgetGetPayload<{
  include: typeof budgetInclude;
}>;

const MAX_BUDGETS = 200;

export class PrismaBudgetRepository implements BudgetRepository {
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
  ): Promise<Budget | null> {
    const row = await this.client.budget.findFirst({
      include: budgetInclude,
      where: { id, ownerId },
    });
    return row === null ? null : restore(row);
  }

  public async listForOwner(ownerId: string): Promise<readonly Budget[]> {
    const rows = await this.client.budget.findMany({
      include: budgetInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_BUDGETS,
      where: { ownerId },
    });
    return rows.map(restore);
  }

  public async insertAtomically(
    request: IdempotencyRequest,
    write: BudgetWrite,
    serialize: (budget: Budget) => string,
  ): Promise<string> {
    try {
      return await this.transactions.run(async () => {
        const client = this.transactions.transactionClient;
        const replayed = await claimIdempotencyKey(client, request);
        if (replayed !== null) return replayed;
        const value = write.budget.toSnapshot();
        await client.budget.create({
          data: {
            ...columns(write.budget),
            createdAt: value.createdAt,
            id: value.id,
          },
        });
        await insertLimits(client, write.budget);
        await insertFinancialAuditEvent(client, write.auditEvent);
        const response = serialize(write.budget);
        await storeIdempotentResponse(client, request, response);
        return response;
      });
    } catch (error) {
      throw overlapOr(error);
    }
  }

  public async saveAtomically(
    id: string,
    ownerId: string,
    expectedVersion: number,
    build: (budget: Budget) => BudgetWrite,
  ): Promise<Budget | null> {
    try {
      return await this.transactions.run(async () => {
        const client = this.transactions.transactionClient;
        const [locked] = await client.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "budgets"
          WHERE "id" = ${id}::uuid AND "owner_id" = ${ownerId}::uuid
          FOR UPDATE
        `;
        if (locked === undefined) return null;
        const row = await client.budget.findUniqueOrThrow({
          include: budgetInclude,
          where: { id: locked.id },
        });
        if (row.version !== expectedVersion) {
          throw new BudgetVersionConflictError();
        }
        const write = build(restore(row));
        const updated = await client.budget.updateMany({
          data: columns(write.budget),
          where: { id, ownerId, version: expectedVersion },
        });
        if (updated.count !== 1) throw new BudgetVersionConflictError();
        await client.budgetLimitVersion.deleteMany({ where: { budgetId: id } });
        await insertLimits(client, write.budget);
        await insertFinancialAuditEvent(client, write.auditEvent);
        return write.budget;
      });
    } catch (error) {
      throw overlapOr(error);
    }
  }
}

function overlapOr(error: unknown): unknown {
  const text = error instanceof Error ? error.message : '';
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P2002' || text.includes('budgets_active_dimension_key')
    ? new BudgetOverlapError()
    : error;
}

function columns(budget: Budget): {
  currencyCode: string;
  currencyMinorUnitScale: number;
  dimensionId: string;
  dimensionKind: string;
  lifecycle: string;
  name: string;
  ownerId: string;
  updatedAt: Date;
  version: number;
} {
  const value = budget.toSnapshot();
  return {
    currencyCode: value.currency.code,
    currencyMinorUnitScale: value.currency.minorUnitScale,
    dimensionId: value.dimension.id,
    dimensionKind: value.dimension.kind,
    lifecycle: value.lifecycle,
    name: value.name,
    ownerId: value.ownerId,
    updatedAt: value.updatedAt,
    version: value.version,
  };
}

async function insertLimits(
  client: QueryClient,
  budget: Budget,
): Promise<void> {
  await client.budgetLimitVersion.createMany({
    data: budget.limits.map((item) => ({
      budgetId: budget.id,
      effectiveFrom: item.effectiveFrom,
      limitMinorUnits: item.limit.toMinorUnits().toString(),
      ownerId: budget.ownerId,
    })),
  });
}

function restore(row: PersistedBudget): Budget {
  const currency = Currency.create(
    row.currencyCode,
    row.currencyMinorUnitScale,
  );
  return Budget.restore({
    createdAt: row.createdAt,
    currency: { code: currency.code, minorUnitScale: currency.minorUnitScale },
    dimension: {
      id: row.dimensionId,
      kind: row.dimensionKind as BudgetDimensionKind,
    },
    id: row.id,
    lifecycle: row.lifecycle as BudgetLifecycle,
    limits: row.limits.map((item) => ({
      effectiveFrom: item.effectiveFrom,
      limit: Money.fromMinorUnits(
        BigInt(item.limitMinorUnits.toFixed(0)),
        currency,
      ).toSnapshot(),
    })),
    name: row.name,
    ownerId: row.ownerId,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}
