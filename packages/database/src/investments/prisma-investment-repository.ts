import {
  InvestmentVersionConflictError,
  type IdempotencyRequest,
  type InvestmentRepository,
  type InvestmentWrite,
} from '@seshat/application';
import {
  Investment,
  type InvestmentIndexer,
  type InvestmentLifecycle,
  type InvestmentLiquidity,
  type InvestmentTypeKey,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import type {
  Investment as PersistedInvestment,
  PrismaClient,
} from '../generated/prisma/client.js';
import {
  claimIdempotencyKey,
  findActiveIdempotentResponse,
  storeIdempotentResponse,
} from '../idempotency/idempotency-records.js';
import { PrismaTransactionRunner } from '../prisma/prisma-transaction-runner.js';

const MAX_INVESTMENTS = 500;

export class PrismaInvestmentRepository implements InvestmentRepository {
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
  ): Promise<Investment | null> {
    const row = await this.client.investment.findFirst({
      where: { id, ownerId },
    });
    return row === null ? null : restore(row);
  }

  public async listForOwner(ownerId: string): Promise<readonly Investment[]> {
    const rows = await this.client.investment.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_INVESTMENTS,
      where: { ownerId },
    });
    return rows.map(restore);
  }

  public insertAtomically(
    request: IdempotencyRequest,
    write: InvestmentWrite,
    serialize: (investment: Investment) => string,
  ): Promise<string> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      const value = write.investment.toSnapshot();
      await client.investment.create({
        data: {
          ...columns(write.investment),
          createdAt: value.createdAt,
          id: value.id,
        },
      });
      await insertFinancialAuditEvent(client, write.auditEvent);
      const response = serialize(write.investment);
      await storeIdempotentResponse(client, request, response);
      return response;
    });
  }

  public saveAtomically(
    id: string,
    ownerId: string,
    expectedVersion: number,
    build: (investment: Investment) => InvestmentWrite,
  ): Promise<Investment | null> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const [locked] = await client.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "investments"
        WHERE "id" = ${id}::uuid AND "owner_id" = ${ownerId}::uuid
        FOR UPDATE
      `;
      if (locked === undefined) return null;
      const row = await client.investment.findUniqueOrThrow({
        where: { id: locked.id },
      });
      if (row.version !== expectedVersion) {
        throw new InvestmentVersionConflictError();
      }
      const write = build(restore(row));
      const updated = await client.investment.updateMany({
        data: columns(write.investment),
        where: { id, ownerId, version: expectedVersion },
      });
      if (updated.count !== 1) throw new InvestmentVersionConflictError();
      await insertFinancialAuditEvent(client, write.auditEvent);
      return write.investment;
    });
  }
}

function columns(
  investment: Investment,
): Omit<PersistedInvestment, 'createdAt' | 'id'> {
  const value = investment.toSnapshot();
  return {
    code: value.code,
    currencyCode: value.currency.code,
    currencyMinorUnitScale: value.currency.minorUnitScale,
    institution: value.institution,
    lifecycle: value.lifecycle,
    liquidityDays:
      value.liquidity.kind === 'd-plus' ? value.liquidity.days : null,
    liquidityKind: value.liquidity.kind,
    maturityDate:
      value.maturityDate === null ? null : civilDate(value.maturityDate),
    name: value.name,
    ownerId: value.ownerId,
    rateIndexer: value.contractedRate?.indexer ?? null,
    ratePercent: value.contractedRate?.percent ?? null,
    startDate: civilDate(value.startDate),
    type: value.type,
    updatedAt: value.updatedAt,
    version: value.version,
  };
}

function restore(row: PersistedInvestment): Investment {
  return Investment.restore({
    code: row.code,
    contractedRate:
      row.rateIndexer === null || row.ratePercent === null
        ? null
        : {
            indexer: row.rateIndexer as InvestmentIndexer,
            percent: row.ratePercent,
          },
    createdAt: row.createdAt,
    currency: {
      code: row.currencyCode,
      minorUnitScale: row.currencyMinorUnitScale,
    },
    id: row.id,
    institution: row.institution,
    lifecycle: row.lifecycle as InvestmentLifecycle,
    liquidity: liquidity(row),
    maturityDate: row.maturityDate === null ? null : isoDate(row.maturityDate),
    name: row.name,
    ownerId: row.ownerId,
    startDate: isoDate(row.startDate),
    type: row.type as InvestmentTypeKey,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}

function liquidity(row: PersistedInvestment): InvestmentLiquidity {
  if (row.liquidityKind === 'd-plus') {
    return { days: row.liquidityDays ?? 0, kind: 'd-plus' };
  }
  return { kind: row.liquidityKind as 'daily' | 'at-maturity' };
}

/** A civil date stored as a PostgreSQL DATE, read back at UTC midnight. */
function civilDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
