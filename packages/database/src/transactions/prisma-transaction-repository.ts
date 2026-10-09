import { LinkedRefundConflictError } from '@seshat/application';
import type {
  AccountTransactionBalanceRepository,
  TransactionFinancialLinkRepository,
  TransactionRepository,
  TransactionTimelineFilters,
} from '@seshat/application';
import {
  calculateRefundSummary,
  Currency,
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
    await this.client.$transaction(async (client) => {
      await client.transaction.create({
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
      await insertFinancialAuditEvent(client, auditEvent);
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
        ...(filters?.kind === undefined ? {} : { kind: filters.kind }),
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
    return this.client.$transaction(async (client) => {
      await client.$queryRaw`
        SELECT id FROM transactions
        WHERE id = ${snapshot.id}::uuid AND owner_id = ${snapshot.ownerId}::uuid
        FOR UPDATE
      `;
      const persisted = await client.transaction.findFirst({
        where: { id: snapshot.id, ownerId: snapshot.ownerId },
      });
      if (persisted?.version !== expectedVersion) {
        return false;
      }
      const entryLink = await client.refundLink.findFirst({
        where: { entryTransactionId: snapshot.id, ownerId: snapshot.ownerId },
      });
      const expenseId = entryLink?.expenseTransactionId ?? snapshot.id;
      if (entryLink !== null) {
        await client.$queryRaw`
          SELECT id FROM transactions
          WHERE id = ${expenseId}::uuid AND owner_id = ${snapshot.ownerId}::uuid
          FOR UPDATE
        `;
      }
      const links = await client.refundLink.findMany({
        include: { entryTransaction: true },
        where: { expenseTransactionId: expenseId, ownerId: snapshot.ownerId },
      });
      if (links.length > 0) {
        if (
          persisted.kind !== snapshot.kind ||
          persisted.amountMinorUnits.toFixed(0) !==
            transaction.amount.toMinorUnits().toString()
        ) {
          throw new LinkedRefundConflictError(
            'Financial values of linked transactions cannot be edited.',
          );
        }
        const expense =
          entryLink === null
            ? persisted
            : await client.transaction.findFirst({
                where: { id: expenseId, ownerId: snapshot.ownerId },
              });
        if (expense === null) throw new LinkedRefundConflictError();
        const currency = Currency.create(
          expense.currencyCode,
          expense.currencyMinorUnitScale,
        );
        try {
          calculateRefundSummary(
            Money.fromMinorUnits(
              BigInt(expense.amountMinorUnits.toFixed(0)),
              currency,
            ),
            links.map((link) => ({
              id: link.id,
              amount: Money.fromMinorUnits(
                BigInt(link.entryTransaction.amountMinorUnits.toFixed(0)),
                Currency.create(
                  link.entryTransaction.currencyCode,
                  link.entryTransaction.currencyMinorUnitScale,
                ),
              ),
              lifecycle:
                link.entryTransactionId === snapshot.id
                  ? snapshot.lifecycle
                  : link.entryTransaction.lifecycle,
              kind: link.kind,
              compensatesRefundId: link.compensatesRefundId,
            })),
          );
        } catch {
          throw new LinkedRefundConflictError(
            'Lifecycle change would invalidate linked refunds.',
          );
        }
      }
      const result = await client.transaction.updateMany({
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
      if (result.count !== 1) return false;
      await insertFinancialAuditEvent(client, auditEvent);
      return true;
    });
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

export function restoreTransaction(row: PersistedTransaction): Transaction {
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
