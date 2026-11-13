import type {
  IdempotencyRequest,
  IdempotentTransferRecord,
  TransferLifecycleRepository,
  TransferReadRepository,
  TransferRepository,
} from '@seshat/application';
import {
  Transaction,
  Transfer,
  type FinancialAuditEvent,
  type TransactionLifecycle,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
import {
  claimIdempotencyKey,
  findActiveIdempotentResponse,
  storeIdempotentResponse,
} from '../idempotency/idempotency-records.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { PrismaTransactionRunner } from '../prisma/prisma-transaction-runner.js';

export class PrismaTransferRepository
  implements
    TransferRepository,
    TransferLifecycleRepository,
    TransferReadRepository
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

  public async insertAtomically(
    transfer: Transfer,
    auditEvent: FinancialAuditEvent,
    idempotency: IdempotentTransferRecord,
  ): Promise<string> {
    const snapshot = transfer.toSnapshot();
    return this.transactions.run(async () => {
      const client = this.transactions.transactionClient;
      const replayed = await claimIdempotencyKey(client, idempotency.request);
      if (replayed !== null) return replayed;
      await client.transaction.create({
        data: transactionCreateData(snapshot.source),
      });
      await client.transaction.create({
        data: transactionCreateData(snapshot.destination),
      });
      await client.transfer.create({
        data: {
          createdAt: snapshot.source.createdAt,
          destinationTransactionId: snapshot.destination.id,
          id: snapshot.id,
          ownerId: snapshot.ownerId,
          sourceTransactionId: snapshot.source.id,
        },
      });
      await insertFinancialAuditEvent(client, auditEvent);
      await storeIdempotentResponse(
        client,
        idempotency.request,
        idempotency.response,
      );
      return idempotency.response;
    });
  }

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Transfer | null> {
    const row = await this.client.transfer.findFirst({
      include: {
        destinationTransaction: true,
        sourceTransaction: true,
      },
      // Eliminated pairs leave every ordinary read (RII-026 option b).
      where: { id, ownerId, sourceTransaction: { eliminatedAt: null } },
    });
    if (row === null) return null;
    return Transfer.restore({
      destination: restoreTransaction(row.destinationTransaction).toSnapshot(),
      id: row.id,
      ownerId: row.ownerId,
      source: restoreTransaction(row.sourceTransaction).toSnapshot(),
    });
  }

  public async listForOwner(
    ownerId: string,
    lifecycle?: TransactionLifecycle,
  ): Promise<readonly Transfer[]> {
    const rows = await this.client.transfer.findMany({
      include: { destinationTransaction: true, sourceTransaction: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: {
        ownerId,
        sourceTransaction: {
          eliminatedAt: null,
          ...(lifecycle === undefined ? {} : { lifecycle }),
        },
      },
    });
    return rows.map((row) =>
      Transfer.restore({
        destination: restoreTransaction(
          row.destinationTransaction,
        ).toSnapshot(),
        id: row.id,
        ownerId: row.ownerId,
        source: restoreTransaction(row.sourceTransaction).toSnapshot(),
      }),
    );
  }

  public async saveAtomically(
    transfer: Transfer,
    expectedSourceVersion: number,
    expectedDestinationVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    const snapshot = transfer.toSnapshot();
    try {
      await this.transactions.run(async () => {
        const client = this.transactions.transactionClient;
        const source = await client.transaction.updateMany({
          data: transactionLifecycleData(snapshot.source),
          where: {
            id: snapshot.source.id,
            ownerId: snapshot.ownerId,
            version: expectedSourceVersion,
          },
        });
        if (source.count !== 1) throw new TransferPersistenceConflict();
        const destination = await client.transaction.updateMany({
          data: transactionLifecycleData(snapshot.destination),
          where: {
            id: snapshot.destination.id,
            ownerId: snapshot.ownerId,
            version: expectedDestinationVersion,
          },
        });
        if (destination.count !== 1) throw new TransferPersistenceConflict();
        await insertFinancialAuditEvent(client, auditEvent);
      });
      return true;
    } catch (error) {
      if (error instanceof TransferPersistenceConflict) return false;
      throw error;
    }
  }
}

class TransferPersistenceConflict extends Error {}

function transactionCreateData(
  snapshot: ReturnType<Transaction['toSnapshot']>,
): Prisma.TransactionUncheckedCreateInput {
  return {
    accountId: snapshot.accountId,
    amountMinorUnits: minorUnits(
      snapshot.amount.amount,
      snapshot.amount.currency.minorUnitScale,
    ),
    archivedAt: snapshot.archivedAt,
    createdAt: snapshot.createdAt,
    currencyCode: snapshot.amount.currency.code,
    currencyMinorUnitScale: snapshot.amount.currency.minorUnitScale,
    description: snapshot.description,
    id: snapshot.id,
    kind: snapshot.kind,
    lifecycle: snapshot.lifecycle,
    observations: snapshot.observations,
    occurredAt: snapshot.occurredAt,
    ownerId: snapshot.ownerId,
    trashedAt: snapshot.trashedAt,
    updatedAt: snapshot.updatedAt,
    version: snapshot.version,
  };
}

function minorUnits(amount: string, scale: number): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  return `${whole}${fraction.padEnd(scale, '0')}`;
}

function transactionLifecycleData(
  snapshot: ReturnType<Transaction['toSnapshot']>,
): Prisma.TransactionUpdateManyMutationInput {
  return {
    archivedAt: snapshot.archivedAt,
    lifecycle: snapshot.lifecycle,
    trashedAt: snapshot.trashedAt,
    updatedAt: snapshot.updatedAt,
    version: snapshot.version,
  };
}

type PersistedTransaction = Exclude<
  Awaited<ReturnType<PrismaClient['transaction']['findFirst']>>,
  null
>;

function restoreTransaction(row: PersistedTransaction): Transaction {
  return Transaction.restore({
    accountId: row.accountId,
    amount: {
      amount: decimalFromMinorUnits(
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

function decimalFromMinorUnits(minorUnitsValue: string, scale: number): string {
  const digits = minorUnitsValue.padStart(scale + 1, '0');
  return scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
