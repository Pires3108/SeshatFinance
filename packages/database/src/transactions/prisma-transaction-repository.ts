import type {
  AccountTransactionBalanceRepository,
  TransactionFinancialLinkRepository,
  TransactionRepository,
  TransactionTimelineFilters,
} from '@seshat/application';
import {
  Currency,
  InvalidTransactionError,
  Money,
  Transaction,
  type FinancialAuditEvent,
} from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';
import { insertFinancialAuditEvent } from '../audit/index.js';

export class PrismaTransactionRepository
  implements
    TransactionRepository,
    TransactionFinancialLinkRepository,
    AccountTransactionBalanceRepository
{
  public constructor(private readonly client: PrismaClient) {}

  public async insert(
    transaction: Transaction,
    auditEvent: FinancialAuditEvent,
  ): Promise<void> {
    const snapshot = transaction.toSnapshot();
    try {
      await this.client.$transaction(async (client) => {
        await client.transaction.create({
          data: {
            accountId: snapshot.accountId,
            amountMinorUnits: transaction.amount.toMinorUnits().toString(),
            archivedAt: snapshot.archivedAt,
            createdAt: snapshot.createdAt,
            counterpartyId: snapshot.counterpartyId ?? null,
            counterpartyName: snapshot.counterpartyName ?? null,
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
        await insertFinancialAuditEvent(client, auditEvent);
      });
    } catch (error) {
      if (isCounterpartyConstraintError(error))
        throw new InvalidTransactionError(
          'Counterparty unavailable for new link.',
        );
      throw error;
    }
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
    lifecycle?: Transaction['lifecycle'],
  ): Promise<readonly Transaction[]> {
    const rows = await this.client.transaction.findMany({
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      where: {
        accountId,
        ownerId,
        ...(lifecycle === undefined ? {} : { lifecycle }),
      },
    });
    return rows.map(restoreTransaction);
  }

  public async sumBalanceEffectsForAccountOwner(
    accountId: string,
    ownerId: string,
  ): Promise<readonly Money[]> {
    const groups = await this.client.transaction.groupBy({
      _sum: { amountMinorUnits: true },
      by: ['kind', 'currencyCode', 'currencyMinorUnitScale'],
      where: {
        accountId,
        lifecycle: { in: ['active', 'archived'] },
        ownerId,
      },
    });
    return groups.map((group) => {
      const amount = group._sum.amountMinorUnits;
      if (amount === null)
        throw new Error('Transaction balance sum is missing.');
      const minorUnits = BigInt(amount.toFixed(0));
      return Money.fromMinorUnits(
        group.kind === 'income' ? minorUnits : -minorUnits,
        Currency.create(group.currencyCode, group.currencyMinorUnitScale),
      );
    });
  }

  public async listForOwnerBetween(
    ownerId: string,
    from: Date,
    to: Date,
    lifecycle?: Transaction['lifecycle'],
    filters?: TransactionTimelineFilters,
  ): Promise<readonly Transaction[]> {
    const rows = await this.client.transaction.findMany({
      orderBy: [
        { occurredAt: filters?.occurredAtOrder ?? 'asc' },
        { id: 'asc' },
      ],
      where: {
        occurredAt: { gte: from, lt: to },
        ownerId,
        ...(lifecycle === undefined ? {} : { lifecycle }),
        ...(filters?.accountId === undefined
          ? {}
          : { accountId: filters.accountId }),
        ...(filters?.costCenterId === undefined
          ? {}
          : { costCenterId: filters.costCenterId }),
        ...(filters?.kind === undefined ? {} : { kind: filters.kind }),
        ...(filters?.tagId === undefined
          ? {}
          : { tagAssignments: { some: { ownerId, tagId: filters.tagId } } }),
      },
    });
    return rows.map(restoreTransaction);
  }

  public async save(
    transaction: Transaction,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    const snapshot = transaction.toSnapshot();
    try {
      return await this.client.$transaction(async (client) => {
        const result = await client.transaction.updateMany({
          data: {
            amountMinorUnits: transaction.amount.toMinorUnits().toString(),
            archivedAt: snapshot.archivedAt,
            description: snapshot.description,
            counterpartyId: snapshot.counterpartyId ?? null,
            counterpartyName: snapshot.counterpartyName ?? null,
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
        if (result.count !== 1) return false;
        await insertFinancialAuditEvent(client, auditEvent);
        return true;
      });
    } catch (error) {
      if (isCounterpartyConstraintError(error))
        throw new InvalidTransactionError(
          'Counterparty unavailable for new link.',
        );
      throw error;
    }
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

function isCounterpartyConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return false;
  return (
    error.code === 'P2003' || error.code === 'P2004' || error.code === 'P2010'
  );
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
    counterpartyId: row.counterpartyId,
    counterpartyName: row.counterpartyName,
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
