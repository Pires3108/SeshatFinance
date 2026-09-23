import type {
  BalanceAdjustmentHistoryItem,
  BalanceAdjustmentHistoryRepository,
  BalanceAdjustmentRepository,
} from '@seshat/application';
import {
  Currency,
  Money,
  type BalanceAdjustment,
  type FinancialAuditEvent,
  type TransactionSnapshot,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/prisma-financial-audit-event-repository.js';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

type CurrentBalanceRow = Readonly<{
  current_balance_minor_units: string;
}>;

export class PrismaBalanceAdjustmentRepository
  implements BalanceAdjustmentRepository, BalanceAdjustmentHistoryRepository
{
  public constructor(private readonly client: PrismaClient) {}

  public async insertAtomically(
    adjustment: BalanceAdjustment,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    const snapshot = adjustment.toSnapshot();
    try {
      return await this.client.$transaction(
        async (client) => {
          const rows = await client.$queryRaw<CurrentBalanceRow[]>`
            SELECT (
              a.initial_balance_minor_units + COALESCE(SUM(
                CASE
                  WHEN t.lifecycle = 'trashed' THEN 0
                  WHEN t.kind = 'income' THEN t.amount_minor_units
                  ELSE -t.amount_minor_units
                END
              ), 0)
            )::text AS current_balance_minor_units
            FROM accounts a
            LEFT JOIN transactions t
              ON t.account_id = a.id AND t.owner_id = a.owner_id
            WHERE a.id = ${snapshot.transaction.accountId}::uuid
              AND a.owner_id = ${snapshot.ownerId}::uuid
            GROUP BY a.initial_balance_minor_units
          `;
          const currentBalance = rows[0]?.current_balance_minor_units;
          const expectedBalance = minorUnits(
            snapshot.previousBalance.amount,
            snapshot.previousBalance.currency.minorUnitScale,
          );
          if (
            currentBalance === undefined ||
            currentBalance !== expectedBalance
          ) {
            return false;
          }
          await client.transaction.create({
            data: transactionCreateData(snapshot.transaction),
          });
          await client.balanceAdjustment.create({
            data: {
              accountId: snapshot.transaction.accountId,
              createdAt: snapshot.transaction.createdAt,
              currencyCode: snapshot.difference.currency.code,
              currencyMinorUnitScale:
                snapshot.difference.currency.minorUnitScale,
              differenceMinorUnits: minorUnits(
                snapshot.difference.amount,
                snapshot.difference.currency.minorUnitScale,
              ),
              id: snapshot.id,
              justification: snapshot.justification,
              ownerId: snapshot.ownerId,
              previousBalanceMinorUnits: expectedBalance,
              reportedBalanceMinorUnits: minorUnits(
                snapshot.reportedBalance.amount,
                snapshot.reportedBalance.currency.minorUnitScale,
              ),
              transactionId: snapshot.transaction.id,
            },
          });
          await insertFinancialAuditEvent(client, auditEvent);
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        return false;
      }
      throw error;
    }
  }

  public async listForAccountOwner(
    accountId: string,
    ownerId: string,
  ): Promise<readonly BalanceAdjustmentHistoryItem[]> {
    const rows = await this.client.balanceAdjustment.findMany({
      include: { transaction: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { accountId, ownerId },
    });
    return rows.map((row) => {
      const currency = Currency.create(
        row.currencyCode,
        row.currencyMinorUnitScale,
      );
      const previousBalance = Money.fromMinorUnits(
        BigInt(row.previousBalanceMinorUnits.toFixed(0)),
        currency,
      );
      const reportedBalance = Money.fromMinorUnits(
        BigInt(row.reportedBalanceMinorUnits.toFixed(0)),
        currency,
      );
      const difference = Money.fromMinorUnits(
        BigInt(row.differenceMinorUnits.toFixed(0)),
        currency,
      );
      const transactionAmount = Money.fromMinorUnits(
        BigInt(row.transaction.amountMinorUnits.toFixed(0)),
        currency,
      );
      const expectedAmount =
        difference.toMinorUnits() < 0n ? difference.negate() : difference;
      if (
        !reportedBalance.subtract(previousBalance).equals(difference) ||
        !transactionAmount.equals(expectedAmount) ||
        row.transaction.accountId !== row.accountId ||
        row.transaction.currencyCode !== currency.code ||
        row.transaction.currencyMinorUnitScale !== currency.minorUnitScale ||
        row.transaction.kind !==
          (difference.toMinorUnits() > 0n ? 'income' : 'expense')
      ) {
        throw new Error('Persisted balance adjustment is inconsistent.');
      }
      return {
        accountId: row.accountId,
        createdAt: row.createdAt,
        difference,
        id: row.id,
        justification: row.justification,
        occurredAt: row.transaction.occurredAt,
        previousBalance,
        reportedBalance,
        transactionId: row.transactionId,
        transactionKind: row.transaction.kind,
      };
    });
  }
}

function transactionCreateData(
  snapshot: TransactionSnapshot,
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
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const digits = `${whole}${fraction.padEnd(scale, '0')}`;
  return negative ? `-${digits}` : digits;
}
