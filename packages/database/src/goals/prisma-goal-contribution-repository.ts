import {
  ContributionSourceNotFoundError,
  ContributionVersionConflictError,
  type ContributionGoalState,
  type ContributionSourceSummary,
  type ContributionSourceView,
  type ContributionWrite,
  type GoalContributionRepository,
  type IdempotencyRequest,
} from '@seshat/application';
import {
  ContributionDistribution,
  Currency,
  Money,
  type GoalContributionPosition,
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

const MAX_SOURCES = 100;

interface SourceRow {
  id: string;
  account_id: string;
  amount_minor_units: Prisma.Decimal;
  currency_code: string;
  currency_minor_unit_scale: number;
  lifecycle: 'active' | 'archived' | 'trashed';
  occurred_at: Date;
  description: string | null;
  transfer_in: boolean;
}

/**
 * Eligible entries (ADR-043, RN-070): incomes and the incoming side of a
 * transfer. Refund entries, balance adjustments and invoice settlements are
 * corrections of other facts, never new money for a goal. An eliminated
 * entry is treated as trashed.
 */
const eligibleSql = `
  SELECT t."id", t."account_id", t."amount_minor_units", t."currency_code",
    t."currency_minor_unit_scale",
    CASE WHEN t."eliminated_at" IS NOT NULL THEN 'trashed'
      ELSE t."lifecycle"::text END AS "lifecycle",
    t."occurred_at", t."description",
    EXISTS (SELECT 1 FROM "transfers" tr
      WHERE tr."destination_transaction_id" = t."id") AS "transfer_in"
  FROM "transactions" t
  WHERE t."owner_id" = $1::uuid
    AND t."kind" = 'income'
    AND NOT EXISTS (SELECT 1 FROM "refund_links" r
      WHERE r."entry_transaction_id" = t."id")
    AND NOT EXISTS (SELECT 1 FROM "balance_adjustments" b
      WHERE b."transaction_id" = t."id")
    AND NOT EXISTS (SELECT 1 FROM "invoice_settlements" s
      WHERE s."transaction_id" = t."id")
    AND NOT EXISTS (SELECT 1 FROM "investment_events" e
      WHERE e."transaction_id" = t."id"
        AND e."kind" IN ('contribution', 'redemption'))`;

export class PrismaGoalContributionRepository implements GoalContributionRepository {
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

  public findDistribution(
    sourceId: string,
    ownerId: string,
  ): Promise<ContributionDistribution | null> {
    return readDistribution(this.client, sourceId, ownerId);
  }

  public async findSource(
    sourceId: string,
    ownerId: string,
  ): Promise<ContributionSourceView | null> {
    const [row] = await this.client.$queryRawUnsafe<SourceRow[]>(
      `${eligibleSql} AND t."id" = $2::uuid`,
      ownerId,
      sourceId.toLowerCase(),
    );
    return row === undefined ? null : sourceOf(row);
  }

  public async listSources(
    ownerId: string,
  ): Promise<readonly ContributionSourceSummary[]> {
    const rows = await this.client.$queryRawUnsafe<SourceRow[]>(
      `${eligibleSql} AND t."lifecycle" <> 'trashed' AND t."eliminated_at" IS NULL
       ORDER BY t."occurred_at" DESC, t."id" LIMIT ${String(MAX_SOURCES)}`,
      ownerId,
    );
    const distributions = await this.client.goalContributionSource.findMany({
      include: { lines: { orderBy: { position: 'asc' } } },
      where: { ownerId, sourceTransactionId: { in: rows.map((r) => r.id) } },
    });
    return rows.map((row) => {
      const source = sourceOf(row);
      const persisted = distributions.find(
        (d) => d.sourceTransactionId === row.id,
      );
      const distribution = persisted === undefined ? null : restore(persisted);
      return {
        ...source,
        allocated: distribution?.allocated ?? null,
        version: distribution?.version ?? 0,
      };
    });
  }

  public async listPositionsForGoals(
    ownerId: string,
    goalIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly GoalContributionPosition[]>> {
    const ids = [...new Set(goalIds.map((id) => id.toLowerCase()))];
    const result = new Map<string, GoalContributionPosition[]>();
    if (ids.length === 0) return result;
    const lines = await this.client.goalContribution.findMany({
      include: {
        source: {
          include: {
            lines: true,
            transaction: {
              select: {
                accountId: true,
                amountMinorUnits: true,
                currencyCode: true,
                currencyMinorUnitScale: true,
                eliminatedAt: true,
                lifecycle: true,
              },
            },
          },
        },
      },
      orderBy: [{ sourceTransactionId: 'asc' }],
      where: { goalId: { in: ids }, ownerId },
    });
    for (const line of lines) {
      const entry = line.source.transaction;
      const currency = Currency.create(
        line.currencyCode,
        line.currencyMinorUnitScale,
      );
      const money = (value: Prisma.Decimal): Money =>
        Money.fromMinorUnits(BigInt(value.toFixed(0)), currency);
      const sameCurrency =
        entry.currencyCode === line.currencyCode &&
        entry.currencyMinorUnitScale === line.currencyMinorUnitScale;
      const positions = result.get(line.goalId) ?? [];
      positions.push({
        accountId: entry.accountId,
        allocatedTotal: line.source.lines.reduce(
          (sum, item) => sum.add(money(item.amountMinorUnits)),
          Money.fromMinorUnits(0n, currency),
        ),
        amount: money(line.amountMinorUnits),
        // A currency mismatch cannot happen through the API; count it zero.
        sourceAmount: sameCurrency
          ? money(entry.amountMinorUnits)
          : Money.fromMinorUnits(0n, currency),
        sourceLifecycle:
          entry.eliminatedAt !== null ? 'trashed' : entry.lifecycle,
        sourceTransactionId: line.sourceTransactionId,
      });
      result.set(line.goalId, positions);
    }
    return result;
  }

  public saveAtomically(
    request: IdempotencyRequest,
    sourceId: string,
    expectedVersion: number,
    goalIds: readonly string[],
    build: (
      current: ContributionDistribution | null,
      source: ContributionSourceView,
      goals: readonly ContributionGoalState[],
    ) => ContributionWrite,
    serialize: (distribution: ContributionDistribution) => string,
  ): Promise<string> {
    const ownerId = request.ownerId;
    const id = sourceId.toLowerCase();
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      // One distribution change at a time per entry (INV-025).
      const [locked] = await client.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "transactions"
        WHERE "id" = ${id}::uuid AND "owner_id" = ${ownerId}::uuid
        FOR UPDATE
      `;
      if (locked === undefined) throw new ContributionSourceNotFoundError();
      const [row] = await client.$queryRawUnsafe<SourceRow[]>(
        `${eligibleSql} AND t."id" = $2::uuid`,
        ownerId,
        id,
      );
      if (row === undefined) throw new ContributionSourceNotFoundError();
      const current = await readDistribution(client, id, ownerId);
      if ((current?.version ?? 0) !== expectedVersion) {
        throw new ContributionVersionConflictError();
      }
      const ids = [...new Set(goalIds.map((g) => g.toLowerCase()))].sort();
      const goals =
        ids.length === 0
          ? []
          : await client.$queryRaw<ContributionGoalState[]>`
              SELECT "id", "lifecycle" FROM "goals"
              WHERE "owner_id" = ${ownerId}::uuid AND "id" = ANY(${ids}::uuid[])
              ORDER BY "id"
              FOR SHARE
            `;
      const write = build(
        current,
        sourceOf(row),
        goals.map((g) => ({
          id: g.id,
          lifecycle: g.lifecycle,
        })),
      );
      await persist(client, write.distribution, expectedVersion);
      await insertFinancialAuditEvent(client, write.auditEvent);
      const response = serialize(write.distribution);
      await storeIdempotentResponse(client, request, response);
      return response;
    });
  }
}

async function readDistribution(
  client: QueryClient,
  sourceId: string,
  ownerId: string,
): Promise<ContributionDistribution | null> {
  const row = await client.goalContributionSource.findFirst({
    include: { lines: { orderBy: { position: 'asc' } } },
    where: { ownerId, sourceTransactionId: sourceId.toLowerCase() },
  });
  return row === null ? null : restore(row);
}

async function persist(
  client: QueryClient,
  distribution: ContributionDistribution,
  expectedVersion: number,
): Promise<void> {
  const value = distribution.toSnapshot();
  if (expectedVersion === 0) {
    await client.goalContributionSource.create({
      data: {
        authorId: value.authorId,
        createdAt: value.createdAt,
        ownerId: value.ownerId,
        sourceTransactionId: value.sourceTransactionId,
        updatedAt: value.updatedAt,
        version: value.version,
      },
    });
  } else {
    const updated = await client.goalContributionSource.updateMany({
      data: {
        authorId: value.authorId,
        updatedAt: value.updatedAt,
        version: value.version,
      },
      where: {
        ownerId: value.ownerId,
        sourceTransactionId: value.sourceTransactionId,
        version: expectedVersion,
      },
    });
    if (updated.count !== 1) throw new ContributionVersionConflictError();
    await client.goalContribution.deleteMany({
      where: { sourceTransactionId: value.sourceTransactionId },
    });
  }
  const lines = distribution.lines;
  if (lines.length === 0) return;
  await client.goalContribution.createMany({
    data: lines.map((line, position) => ({
      amountMinorUnits: line.amount.toMinorUnits().toString(),
      currencyCode: line.amount.currency.code,
      currencyMinorUnitScale: line.amount.currency.minorUnitScale,
      goalId: line.goalId,
      ownerId: value.ownerId,
      position,
      sourceTransactionId: value.sourceTransactionId,
    })),
  });
}

function sourceOf(row: SourceRow): ContributionSourceView {
  return {
    accountId: row.account_id,
    amount: Money.fromMinorUnits(
      BigInt(row.amount_minor_units.toFixed(0)),
      Currency.create(row.currency_code, row.currency_minor_unit_scale),
    ),
    description: row.description,
    id: row.id,
    kind: row.transfer_in ? 'transfer-in' : 'income',
    lifecycle: row.lifecycle,
    occurredAt: row.occurred_at,
  };
}

type PersistedSource = Prisma.GoalContributionSourceGetPayload<{
  include: { lines: true };
}>;

function restore(row: PersistedSource): ContributionDistribution {
  return ContributionDistribution.restore({
    authorId: row.authorId,
    createdAt: row.createdAt,
    lines: row.lines.map((line) => ({
      amount: Money.fromMinorUnits(
        BigInt(line.amountMinorUnits.toFixed(0)),
        Currency.create(line.currencyCode, line.currencyMinorUnitScale),
      ).toSnapshot(),
      goalId: line.goalId,
    })),
    ownerId: row.ownerId,
    sourceTransactionId: row.sourceTransactionId,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}
