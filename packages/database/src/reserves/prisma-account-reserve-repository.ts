import {
  AccountReserveVersionConflictError,
  ReserveAccountNotFoundError,
  type AccountReserveRepository,
  type AccountReserveWrite,
  type IdempotencyRequest,
} from '@seshat/application';
import { AccountReserve, Currency, Money } from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  claimIdempotencyKey,
  findActiveIdempotentResponse,
  storeIdempotentResponse,
} from '../idempotency/idempotency-records.js';
import { PrismaTransactionRunner } from '../prisma/prisma-transaction-runner.js';

type QueryClient = PrismaClient | Prisma.TransactionClient;
type PersistedReserve = Prisma.AccountReserveGetPayload<object>;

export class PrismaAccountReserveRepository implements AccountReserveRepository {
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

  public async findForOwner(
    accountId: string,
    ownerId: string,
  ): Promise<AccountReserve | null> {
    const row = await readReserve(this.client, accountId, ownerId);
    return row === null ? null : restore(row);
  }

  public async listForOwner(
    ownerId: string,
  ): Promise<readonly AccountReserve[]> {
    const rows = await this.client.accountReserve.findMany({
      orderBy: { accountId: 'asc' },
      where: { ownerId },
    });
    return rows.map(restore);
  }

  public saveAtomically(
    request: IdempotencyRequest,
    accountId: string,
    expectedVersion: number,
    build: (current: AccountReserve | null) => AccountReserveWrite,
    serialize: (reserve: AccountReserve) => string,
  ): Promise<string> {
    const ownerId = request.ownerId;
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, request);
      if (replayed !== null) return replayed;
      // Serializes every reserve change of the account (version check below).
      const [locked] = await client.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "accounts"
        WHERE "id" = ${accountId}::uuid AND "owner_id" = ${ownerId}::uuid
        FOR UPDATE
      `;
      if (locked === undefined) throw new ReserveAccountNotFoundError();
      const row = await readReserve(client, accountId, ownerId);
      const current = row === null ? null : restore(row);
      if ((current?.version ?? 0) !== expectedVersion) {
        throw new AccountReserveVersionConflictError();
      }
      const write = build(current);
      await persist(client, write.reserve, expectedVersion);
      await insertFinancialAuditEvent(client, write.auditEvent);
      const response = serialize(write.reserve);
      await storeIdempotentResponse(client, request, response);
      return response;
    });
  }
}

function readReserve(
  client: QueryClient,
  accountId: string,
  ownerId: string,
): Promise<PersistedReserve | null> {
  return client.accountReserve.findFirst({
    where: { accountId: accountId.toLowerCase(), ownerId },
  });
}

async function persist(
  client: QueryClient,
  reserve: AccountReserve,
  expectedVersion: number,
): Promise<void> {
  const value = reserve.toSnapshot();
  const amount = reserve.amount;
  const columns = {
    amountMinorUnits: amount.toMinorUnits().toString(),
    currencyCode: amount.currency.code,
    currencyMinorUnitScale: amount.currency.minorUnitScale,
    updatedAt: value.updatedAt,
    version: value.version,
  };
  if (expectedVersion === 0) {
    await client.accountReserve.create({
      data: {
        ...columns,
        accountId: value.accountId,
        createdAt: value.createdAt,
        ownerId: value.ownerId,
      },
    });
    return;
  }
  const updated = await client.accountReserve.updateMany({
    data: columns,
    where: {
      accountId: value.accountId,
      ownerId: value.ownerId,
      version: expectedVersion,
    },
  });
  if (updated.count !== 1) throw new AccountReserveVersionConflictError();
}

function restore(row: PersistedReserve): AccountReserve {
  return AccountReserve.restore({
    accountId: row.accountId,
    amount: Money.fromMinorUnits(
      BigInt(row.amountMinorUnits.toFixed(0)),
      Currency.create(row.currencyCode, row.currencyMinorUnitScale),
    ).toSnapshot(),
    createdAt: row.createdAt,
    ownerId: row.ownerId,
    updatedAt: row.updatedAt,
    version: row.version,
  });
}
