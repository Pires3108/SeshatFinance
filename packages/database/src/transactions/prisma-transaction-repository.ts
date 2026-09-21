import type {
  TransactionFinancialLinkRepository,
  TransactionRepository,
} from '@seshat/application';
import { Transaction } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaTransactionRepository
  implements TransactionRepository, TransactionFinancialLinkRepository
{
  public constructor(private readonly client: PrismaClient) {}

  public async insert(transaction: Transaction): Promise<void> {
    const snapshot = transaction.toSnapshot();
    await this.client.transaction.create({
      data: {
        accountId: snapshot.accountId,
        amountMinorUnits: transaction.amount.toMinorUnits().toString(),
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
      },
    });
  }

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Transaction | null> {
    const row = await this.client.transaction.findFirst({
      where: { id, ownerId },
    });
    return row === null ? null : restoreTransaction(row);
  }

  public async listForAccountOwner(
    accountId: string,
    ownerId: string,
  ): Promise<readonly Transaction[]> {
    const rows = await this.client.transaction.findMany({
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      where: { accountId, ownerId },
    });
    return rows.map(restoreTransaction);
  }

  public async listForOwnerBetween(
    ownerId: string,
    from: Date,
    to: Date,
  ): Promise<readonly Transaction[]> {
    const rows = await this.client.transaction.findMany({
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      where: { occurredAt: { gte: from, lt: to }, ownerId },
    });
    return rows.map(restoreTransaction);
  }

  public async save(
    transaction: Transaction,
    expectedVersion: number,
  ): Promise<boolean> {
    const snapshot = transaction.toSnapshot();
    const result = await this.client.transaction.updateMany({
      data: {
        amountMinorUnits: transaction.amount.toMinorUnits().toString(),
        archivedAt: snapshot.archivedAt,
        description: snapshot.description,
        kind: snapshot.kind,
        lifecycle: snapshot.lifecycle,
        observations: snapshot.observations,
        occurredAt: snapshot.occurredAt,
        trashedAt: snapshot.trashedAt,
        updatedAt: snapshot.updatedAt,
        version: snapshot.version,
      },
      where: {
        id: snapshot.id,
        ownerId: snapshot.ownerId,
        version: expectedVersion,
      },
    });
    return result.count === 1;
  }

  public async findTransferIdByEntryForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<string | null> {
    const transfer = await this.client.transfer.findFirst({
      select: { id: true },
      where: {
        OR: [
          { sourceTransactionId: transactionId },
          { destinationTransactionId: transactionId },
        ],
        ownerId,
      },
    });
    return transfer?.id ?? null;
  }
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

function decimalFromMinorUnits(minorUnits: string, scale: number): string {
  const digits = minorUnits.padStart(scale + 1, '0');
  return scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
