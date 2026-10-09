import { createHash } from 'node:crypto';

import {
  LinkedRefundConflictError,
  LinkedRefundUnavailableError,
  type LinkedRefundDetails,
  type LinkedRefundRecord,
  type LinkedRefundRepository,
} from '@seshat/application';
import {
  calculateRefundSummary,
  Currency,
  Money,
  type FinancialAuditEvent,
  type RefundLedgerEntry,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/prisma-financial-audit-event-repository.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { restoreTransaction } from '../transactions/prisma-transaction-repository.js';

type RefundClient = Prisma.TransactionClient;
type RefundRow = Prisma.RefundLinkGetPayload<{
  include: { entryTransaction: true };
}>;

export class PrismaLinkedRefundRepository implements LinkedRefundRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async record(
    record: LinkedRefundRecord,
    idempotencyKey: string,
    auditEvent: FinancialAuditEvent,
  ): Promise<LinkedRefundRecord> {
    const ownerId = record.entry.ownerId;
    const fingerprint = fingerprintRecord(record);
    const existing = await this.findByKey(ownerId, idempotencyKey);
    if (existing !== null) return matchingRecord(existing, fingerprint);
    try {
      return await this.client.$transaction(async (client) => {
        await client.$queryRaw`
          SELECT id FROM transactions
          WHERE id = ${record.expenseTransactionId}::uuid
            AND owner_id = ${ownerId}::uuid FOR UPDATE
        `;
        const prior = await client.refundLink.findUnique({
          include: { entryTransaction: true },
          where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
        });
        if (prior !== null) return matchingRecord(prior, fingerprint);
        const expense = await client.transaction.findFirst({
          where: { id: record.expenseTransactionId, ownerId },
        });
        if (expense?.kind !== 'expense' || expense.lifecycle === 'trashed') {
          throw new LinkedRefundUnavailableError();
        }
        await client.$queryRaw`
          SELECT id FROM accounts
          WHERE id = ${record.entry.accountId}::uuid
            AND owner_id = ${ownerId}::uuid FOR SHARE
        `;
        const account = await client.account.findFirst({
          where: { id: record.entry.accountId, ownerId },
        });
        const currency = record.entry.amount.currency;
        if (
          account?.lifecycle !== 'active' ||
          account.currencyCode !== currency.code ||
          account.currencyMinorUnitScale !== currency.minorUnitScale ||
          expense.currencyCode !== currency.code ||
          expense.currencyMinorUnitScale !== currency.minorUnitScale
        ) {
          throw new LinkedRefundUnavailableError();
        }
        const rows = await listRows(
          client,
          record.expenseTransactionId,
          ownerId,
        );
        if (record.kind === 'compensation') {
          const original = rows.find(
            (row) => row.id === record.compensatesRefundId,
          );
          if (
            original?.kind !== 'refund' ||
            original.entryTransaction.lifecycle === 'trashed'
          ) {
            throw new LinkedRefundUnavailableError();
          }
        }
        const gross = Money.fromMinorUnits(
          BigInt(expense.amountMinorUnits.toFixed(0)),
          currency,
        );
        calculateRefundSummary(gross, [
          ...rows.map(toLedgerEntry),
          {
            id: record.id,
            amount: record.entry.amount,
            lifecycle: 'active',
            kind: record.kind,
            compensatesRefundId: record.compensatesRefundId,
          },
        ]);
        const entry = record.entry.toSnapshot();
        await client.transaction.create({
          data: {
            accountId: entry.accountId,
            amountMinorUnits: record.entry.amount.toMinorUnits().toString(),
            archivedAt: entry.archivedAt,
            createdAt: entry.createdAt,
            currencyCode: currency.code,
            currencyMinorUnitScale: currency.minorUnitScale,
            description: entry.description,
            id: entry.id,
            kind: entry.kind,
            lifecycle: entry.lifecycle,
            observations: entry.observations,
            occurredAt: entry.occurredAt,
            ownerId,
            trashedAt: entry.trashedAt,
            updatedAt: entry.updatedAt,
            version: entry.version,
          },
        });
        await client.refundLink.create({
          data: {
            compensatesRefundId: record.compensatesRefundId,
            createdAt: record.createdAt,
            entryTransactionId: entry.id,
            expenseTransactionId: record.expenseTransactionId,
            id: record.id,
            idempotencyKey,
            kind: record.kind,
            ownerId,
            reason: record.reason,
            requestFingerprint: fingerprint,
          },
        });
        await insertFinancialAuditEvent(client, auditEvent);
        return record;
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        const duplicate = await this.findByKey(ownerId, idempotencyKey);
        if (duplicate !== null) return matchingRecord(duplicate, fingerprint);
      }
      throw error;
    }
  }

  public async getForExpense(
    expenseTransactionId: string,
    ownerId: string,
  ): Promise<LinkedRefundDetails | null> {
    const expense = await this.client.transaction.findFirst({
      where: { id: expenseTransactionId, ownerId, kind: 'expense' },
    });
    if (expense === null) return null;
    const rows = await listRows(this.client, expenseTransactionId, ownerId);
    const currency = Currency.create(
      expense.currencyCode,
      expense.currencyMinorUnitScale,
    );
    return {
      expenseTransactionId,
      summary: calculateRefundSummary(
        Money.fromMinorUnits(
          BigInt(expense.amountMinorUnits.toFixed(0)),
          currency,
        ),
        rows.map(toLedgerEntry),
      ),
      entries: rows.map(toRecord),
    };
  }

  private findByKey(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<RefundRow | null> {
    return this.client.refundLink.findUnique({
      include: { entryTransaction: true },
      where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
    });
  }
}

function listRows(
  client: RefundClient | PrismaClient,
  expenseTransactionId: string,
  ownerId: string,
): Promise<RefundRow[]> {
  return client.refundLink.findMany({
    include: { entryTransaction: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    where: { expenseTransactionId, ownerId },
  });
}

function toLedgerEntry(row: RefundRow): RefundLedgerEntry {
  return {
    amount: Money.fromMinorUnits(
      BigInt(row.entryTransaction.amountMinorUnits.toFixed(0)),
      Currency.create(
        row.entryTransaction.currencyCode,
        row.entryTransaction.currencyMinorUnitScale,
      ),
    ),
    compensatesRefundId: row.compensatesRefundId,
    id: row.id,
    kind: row.kind,
    lifecycle: row.entryTransaction.lifecycle,
  };
}

function toRecord(row: RefundRow): LinkedRefundRecord {
  return {
    compensatesRefundId: row.compensatesRefundId,
    createdAt: row.createdAt,
    entry: restoreTransaction(row.entryTransaction),
    expenseTransactionId: row.expenseTransactionId,
    id: row.id,
    kind: row.kind,
    reason: row.reason,
  };
}

function fingerprintRecord(record: LinkedRefundRecord): string {
  const entry = record.entry.toSnapshot();
  return createHash('sha256')
    .update(
      JSON.stringify({
        ownerId: entry.ownerId,
        expenseTransactionId: record.expenseTransactionId,
        accountId: entry.accountId,
        amount: record.entry.amount.toMinorUnits().toString(),
        currencyCode: entry.amount.currency.code,
        currencyMinorUnitScale: entry.amount.currency.minorUnitScale,
        description: entry.description,
        occurredAt: entry.occurredAt.toISOString(),
        kind: record.kind,
        compensatesRefundId: record.compensatesRefundId,
        reason: record.reason,
      }),
    )
    .digest('hex');
}

function matchingRecord(
  row: RefundRow,
  fingerprint: string,
): LinkedRefundRecord {
  if (row.requestFingerprint !== fingerprint) {
    throw new LinkedRefundConflictError('Idempotency key was reused.');
  }
  return toRecord(row);
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'P2002';
}
