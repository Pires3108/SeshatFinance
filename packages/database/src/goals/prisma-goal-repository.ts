import {
  GoalVersionConflictError,
  type ExistingAccountShare,
  type GoalRepository,
  type GoalWrite,
  type IdempotencyRequest,
} from '@seshat/application';
import {
  Currency,
  Goal,
  Money,
  type GoalAccountLinkSnapshot,
  type GoalLifecycle,
  type GoalMode,
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

const goalInclude = {
  links: { orderBy: { position: 'asc' } },
} as const satisfies Prisma.GoalInclude;

type PersistedGoal = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;

const MAX_GOALS = 200;

export class PrismaGoalRepository implements GoalRepository {
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
  ): Promise<Goal | null> {
    const row = await this.client.goal.findFirst({
      include: goalInclude,
      where: { id, ownerId },
    });
    return row === null ? null : restore(row);
  }

  public async listForOwner(ownerId: string): Promise<readonly Goal[]> {
    const rows = await this.client.goal.findMany({
      include: goalInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: MAX_GOALS,
      where: { ownerId },
    });
    return rows.map(restore);
  }

  public listSharesForAccounts(
    ownerId: string,
    accountIds: readonly string[],
  ): Promise<readonly ExistingAccountShare[]> {
    return readShares(this.client, ownerId, accountIds);
  }

  public insertAtomically(
    request: IdempotencyRequest,
    ownerId: string,
    accountIds: readonly string[],
    build: (shares: readonly ExistingAccountShare[]) => GoalWrite,
    serialize: (goal: Goal) => string,
  ): Promise<string> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      await lockAccounts(client, ownerId, accountIds);
      const write = build(await readShares(client, ownerId, accountIds));
      await insertGoal(client, write.goal);
      await insertFinancialAuditEvent(client, write.auditEvent);
      const response = serialize(write.goal);
      await storeIdempotentResponse(client, request, response);
      return response;
    });
  }

  public saveAtomically(
    goalId: string,
    ownerId: string,
    expectedVersion: number,
    accountIds: readonly string[],
    build: (goal: Goal, shares: readonly ExistingAccountShare[]) => GoalWrite,
  ): Promise<Goal | null> {
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      await lockAccounts(client, ownerId, accountIds);
      const [locked] = await client.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "goals"
        WHERE "id" = ${goalId}::uuid AND "owner_id" = ${ownerId}::uuid
        FOR UPDATE
      `;
      if (locked === undefined) return null;
      const row = await client.goal.findUniqueOrThrow({
        include: goalInclude,
        where: { id: locked.id },
      });
      if (row.version !== expectedVersion) throw new GoalVersionConflictError();
      const write = build(
        restore(row),
        await readShares(client, ownerId, accountIds),
      );
      await updateGoal(client, write.goal, expectedVersion);
      await insertFinancialAuditEvent(client, write.auditEvent);
      return write.goal;
    });
  }
}

/**
 * Serializes every share declaration on the same accounts (RN-069): two
 * goals cannot both claim the last part of a balance. Locks follow id order.
 */
async function lockAccounts(
  client: Prisma.TransactionClient,
  ownerId: string,
  accountIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(accountIds.map((id) => id.toLowerCase()))].sort();
  if (ids.length === 0) return;
  await client.$queryRaw`
    SELECT "id" FROM "accounts"
    WHERE "owner_id" = ${ownerId}::uuid AND "id" = ANY(${ids}::uuid[])
    ORDER BY "id"
    FOR UPDATE
  `;
}

async function readShares(
  client: QueryClient,
  ownerId: string,
  accountIds: readonly string[],
): Promise<readonly ExistingAccountShare[]> {
  const ids = [...new Set(accountIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return [];
  const rows = await client.goalAccountLink.findMany({
    orderBy: [{ goalId: 'asc' }, { accountId: 'asc' }],
    where: {
      accountId: { in: ids },
      goal: { lifecycle: { not: 'archived' } },
      ownerId,
    },
  });
  return rows.map((row) => ({
    accountId: row.accountId,
    goalId: row.goalId,
    share:
      restoreLink(row).share.kind === 'full'
        ? { kind: 'full' as const }
        : {
            amount: shareMoney(row),
            kind: 'amount' as const,
          },
  }));
}

async function insertGoal(client: QueryClient, goal: Goal): Promise<void> {
  const value = goal.toSnapshot();
  await client.goal.create({
    data: {
      ...goalColumns(goal),
      createdAt: value.createdAt,
      id: value.id,
      ownerId: value.ownerId,
    },
  });
  await insertLinks(client, value.id, value.ownerId, value.links);
}

async function insertLinks(
  client: QueryClient,
  goalId: string,
  ownerId: string,
  links: readonly GoalAccountLinkSnapshot[],
): Promise<void> {
  if (links.length === 0) return;
  await client.goalAccountLink.createMany({
    data: linkRows(links).map((link) => ({ ...link, goalId, ownerId })),
  });
}

async function updateGoal(
  client: QueryClient,
  goal: Goal,
  expectedVersion: number,
): Promise<void> {
  const value = goal.toSnapshot();
  const updated = await client.goal.updateMany({
    data: goalColumns(goal),
    where: { id: value.id, ownerId: value.ownerId, version: expectedVersion },
  });
  if (updated.count !== 1) throw new GoalVersionConflictError();
  await client.goalAccountLink.deleteMany({ where: { goalId: value.id } });
  await insertLinks(client, value.id, value.ownerId, value.links);
}

function goalColumns(goal: Goal): {
  currencyCode: string;
  currencyMinorUnitScale: number;
  deadline: Date | null;
  initialMinorUnits: string;
  lifecycle: string;
  mode: string;
  name: string;
  targetMinorUnits: string;
  updatedAt: Date;
  version: number;
} {
  const value = goal.toSnapshot();
  return {
    currencyCode: goal.target.currency.code,
    currencyMinorUnitScale: goal.target.currency.minorUnitScale,
    deadline:
      value.deadline === null
        ? null
        : new Date(`${value.deadline}T00:00:00.000Z`),
    initialMinorUnits: goal.initialAmount.toMinorUnits().toString(),
    lifecycle: value.lifecycle,
    mode: value.mode,
    name: value.name,
    targetMinorUnits: goal.target.toMinorUnits().toString(),
    updatedAt: value.updatedAt,
    version: value.version,
  };
}

function linkRows(links: readonly GoalAccountLinkSnapshot[]): {
  accountId: string;
  position: number;
  shareKind: string;
  shareMinorUnits: string | null;
  shareCurrencyCode: string | null;
  shareCurrencyMinorUnitScale: number | null;
}[] {
  return links.map((link, position) => {
    if (link.share.kind === 'full') {
      return {
        accountId: link.accountId,
        position,
        shareCurrencyCode: null,
        shareCurrencyMinorUnitScale: null,
        shareKind: 'full',
        shareMinorUnits: null,
      };
    }
    const amount = Money.restore(link.share.amount);
    return {
      accountId: link.accountId,
      position,
      shareCurrencyCode: amount.currency.code,
      shareCurrencyMinorUnitScale: amount.currency.minorUnitScale,
      shareKind: 'amount',
      shareMinorUnits: amount.toMinorUnits().toString(),
    };
  });
}

type PersistedLink = PersistedGoal['links'][number];

function shareMoney(link: PersistedLink): Money {
  if (
    link.shareMinorUnits === null ||
    link.shareCurrencyCode === null ||
    link.shareCurrencyMinorUnitScale === null
  ) {
    throw new Error('An amount share needs its value and currency.');
  }
  return Money.fromMinorUnits(
    BigInt(link.shareMinorUnits.toFixed(0)),
    Currency.create(link.shareCurrencyCode, link.shareCurrencyMinorUnitScale),
  );
}

function restoreLink(link: PersistedLink): GoalAccountLinkSnapshot {
  return {
    accountId: link.accountId,
    share:
      link.shareKind === 'full'
        ? { kind: 'full' }
        : { amount: shareMoney(link).toSnapshot(), kind: 'amount' },
  };
}

function restore(row: PersistedGoal): Goal {
  const currency = Currency.create(
    row.currencyCode,
    row.currencyMinorUnitScale,
  );
  const money = (value: Prisma.Decimal): Money =>
    Money.fromMinorUnits(BigInt(value.toFixed(0)), currency);
  return Goal.restore({
    createdAt: row.createdAt,
    deadline:
      row.deadline === null ? null : row.deadline.toISOString().slice(0, 10),
    id: row.id,
    initialAmount: money(row.initialMinorUnits).toSnapshot(),
    lifecycle: row.lifecycle as GoalLifecycle,
    links: row.links.map(restoreLink),
    mode: row.mode as GoalMode,
    name: row.name,
    ownerId: row.ownerId,
    target: money(row.targetMinorUnits).toSnapshot(),
    updatedAt: row.updatedAt,
    version: row.version,
  });
}
