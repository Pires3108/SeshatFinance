import { LinkedRefundConflictError } from '@seshat/application';
import type {
  AccountTransactionBalanceRepository,
  TemporalTransaction,
  TransactionFinancialLinkRepository,
  TransactionRepository,
  TransactionTimelineFilters,
  TransactionRevision,
} from '@seshat/application';
import {
  calculateRefundSummary,
  Currency,
  InvalidTransactionError,
  Money,
  Transaction,
  type FinancialAuditEvent,
} from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
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
    idempotency?: Readonly<{ key: string; fingerprint: string }>,
  ): Promise<void> {
    const snapshot = transaction.toSnapshot();
    try {
      await this.client.$transaction(async (client) => {
        await validateMetadata(client, snapshot, []);
        await validateCounterparty(
          client,
          snapshot.ownerId,
          snapshot.counterpartyId ?? null,
          null,
        );
        await client.transaction.create({
          data: {
            accountId: snapshot.accountId,
            categoryId: snapshot.categoryId ?? null,
            subcategoryId: snapshot.subcategoryId ?? null,
            costCenterId: snapshot.costCenterId ?? null,
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
        if ((snapshot.tagIds?.length ?? 0) > 0)
          await client.transactionTag.createMany({
            data: (snapshot.tagIds ?? []).map((tagId) => ({
              transactionId: snapshot.id,
              ownerId: snapshot.ownerId,
              tagId,
            })),
          });
        if (idempotency !== undefined)
          await client.transactionIdempotency.create({
            data: {
              ownerId: snapshot.ownerId,
              key: idempotency.key,
              fingerprint: idempotency.fingerprint,
              transactionId: snapshot.id,
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

  public async findByIdempotencyKey(
    ownerId: string,
    key: string,
  ): Promise<Readonly<{
    transaction: Transaction;
    fingerprint: string;
  }> | null> {
    const record = await this.client.transactionIdempotency.findUnique({
      where: { ownerId_key: { ownerId, key } },
    });
    if (record === null) return null;
    const transaction = await this.findByIdForOwner(
      record.transactionId,
      ownerId,
    );
    return transaction === null
      ? null
      : { transaction, fingerprint: record.fingerprint };
  }

  public async listRevisionsForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<readonly TransactionRevision[]> {
    const exists = await this.client.transaction.findFirst({
      select: { id: true },
      where: { id: transactionId, ownerId, eliminatedAt: null },
    });
    if (exists === null) return [];
    const rows = await this.client.transactionRevision.findMany({
      where: { transactionId, ownerId },
      orderBy: { newVersion: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      previousVersion: row.previousVersion,
      newVersion: row.newVersion,
      before: row.before,
      after: row.after,
      occurredAt: row.occurredAt,
    }));
  }

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Transaction | null> {
    const row = await this.client.transaction.findFirst({
      include: { tagAssignments: { select: { tagId: true } } },
      // Eliminated entries leave every ordinary read (RII-026 option b).
      where: { id, ownerId, eliminatedAt: null },
    });
    return row === null ? null : restoreTransaction(row);
  }

  public async listForAccountOwner(
    accountId: string,
    ownerId: string,
    lifecycle?: Transaction['lifecycle'],
  ): Promise<readonly Transaction[]> {
    const rows = await this.client.transaction.findMany({
      include: { tagAssignments: { select: { tagId: true } } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      where: {
        accountId,
        ownerId,
        eliminatedAt: null,
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
      include: { tagAssignments: { select: { tagId: true } } },
      orderBy: [
        { occurredAt: filters?.occurredAtOrder ?? 'asc' },
        { id: 'asc' },
      ],
      where: {
        occurredAt: { gte: from, lt: to },
        ownerId,
        eliminatedAt: null,
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

  public async listWithTimeZoneForOwnerBetween(
    ownerId: string,
    from: Date,
    to: Date,
    lifecycle: 'active',
  ): Promise<readonly TemporalTransaction[]> {
    const rows = await this.client.transaction.findMany({
      include: { tagAssignments: { select: { tagId: true } } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      where: { occurredAt: { gte: from, lt: to }, ownerId, lifecycle },
    });
    return rows.map((row) => ({
      transaction: restoreTransaction(row),
      timeZone: row.timeZone,
    }));
  }

  public async save(
    transaction: Transaction,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    const snapshot = transaction.toSnapshot();
    try {
      return await this.client.$transaction(async (client) => {
        await client.$queryRaw`
          SELECT id FROM transactions
          WHERE id = ${snapshot.id}::uuid AND owner_id = ${snapshot.ownerId}::uuid
          FOR UPDATE`;
        const current = await client.transaction.findFirst({
          include: { tagAssignments: { select: { tagId: true } } },
          where: {
            id: snapshot.id,
            ownerId: snapshot.ownerId,
            version: expectedVersion,
          },
        });
        if (current === null) return false;
        const entryLink = await client.refundLink.findFirst({
          where: { entryTransactionId: snapshot.id, ownerId: snapshot.ownerId },
        });
        const expenseId = entryLink?.expenseTransactionId ?? snapshot.id;
        if (entryLink !== null) {
          await client.$queryRaw`
            SELECT id FROM transactions
            WHERE id = ${expenseId}::uuid AND owner_id = ${snapshot.ownerId}::uuid
            FOR UPDATE`;
        }
        const links = await client.refundLink.findMany({
          include: { entryTransaction: true },
          where: { expenseTransactionId: expenseId, ownerId: snapshot.ownerId },
        });
        if (links.length > 0) {
          if (
            current.kind !== snapshot.kind ||
            current.amountMinorUnits.toFixed(0) !==
              transaction.amount.toMinorUnits().toString()
          ) {
            throw new LinkedRefundConflictError(
              'Financial values of linked transactions cannot be edited.',
            );
          }
          const expense =
            entryLink === null
              ? current
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
        await validateMetadata(
          client,
          snapshot,
          current.tagAssignments.map(({ tagId }) => tagId),
          {
            categoryId: current.categoryId,
            subcategoryId: current.subcategoryId,
            costCenterId: current.costCenterId,
          },
        );
        await validateCounterparty(
          client,
          snapshot.ownerId,
          snapshot.counterpartyId ?? null,
          current.counterpartyId,
        );
        const result = await client.transaction.updateMany({
          data: {
            categoryId: snapshot.categoryId ?? null,
            subcategoryId: snapshot.subcategoryId ?? null,
            costCenterId: snapshot.costCenterId ?? null,
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
        if (snapshot.tagIds !== undefined) {
          const next = [...new Set(snapshot.tagIds)];
          await client.transactionTag.deleteMany({
            where: {
              transactionId: snapshot.id,
              ownerId: snapshot.ownerId,
              tagId: { notIn: next },
            },
          });
          await client.transactionTag.createMany({
            data: next
              .filter(
                (tagId) =>
                  !current.tagAssignments.some((item) => item.tagId === tagId),
              )
              .map((tagId) => ({
                transactionId: snapshot.id,
                ownerId: snapshot.ownerId,
                tagId,
              })),
          });
        }
        await insertFinancialAuditEvent(client, auditEvent);
        await client.transactionRevision.create({
          data: {
            id: auditEvent.toSnapshot().id,
            ownerId: snapshot.ownerId,
            transactionId: snapshot.id,
            actorId: snapshot.ownerId,
            previousVersion: expectedVersion,
            newVersion: snapshot.version,
            before: revisionValue(restoreTransaction(current)),
            after: revisionValue(transaction),
            occurredAt: snapshot.updatedAt,
          },
        });
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

function revisionValue(transaction: Transaction): Prisma.InputJsonValue {
  const value = transaction.toSnapshot();
  return {
    accountId: value.accountId,
    amount: value.amount.amount,
    currencyCode: value.amount.currency.code,
    currencyMinorUnitScale: value.amount.currency.minorUnitScale,
    kind: value.kind,
    lifecycle: value.lifecycle,
    archivedAt: value.archivedAt?.toISOString() ?? null,
    trashedAt: value.trashedAt?.toISOString() ?? null,
    occurredAt: value.occurredAt.toISOString(),
    description: value.description,
    observations: value.observations,
    counterpartyId: value.counterpartyId ?? null,
    counterpartyName: value.counterpartyName ?? null,
    categoryId: value.categoryId ?? null,
    subcategoryId: value.subcategoryId ?? null,
    costCenterId: value.costCenterId ?? null,
    tagIds: [...(value.tagIds ?? [])],
  };
}

async function validateMetadata(
  client: Prisma.TransactionClient,
  snapshot: ReturnType<Transaction['toSnapshot']>,
  currentTagIds: readonly string[],
  current?: Readonly<{
    categoryId: string | null;
    subcategoryId: string | null;
    costCenterId: string | null;
  }>,
): Promise<void> {
  if (snapshot.subcategoryId != null && snapshot.categoryId == null)
    throw new InvalidTransactionError('A subcategory requires a category.');
  if (snapshot.categoryId != null) {
    await client.$queryRaw`SELECT id FROM categories WHERE id = ${snapshot.categoryId}::uuid AND owner_id = ${snapshot.ownerId}::uuid FOR SHARE`;
    const category = await client.category.findFirst({
      where: {
        id: snapshot.categoryId,
        ownerId: snapshot.ownerId,
        parentCategoryId: null,
        ...(current?.categoryId === snapshot.categoryId &&
        current.subcategoryId === snapshot.subcategoryId
          ? {}
          : { archivedAt: null }),
      },
    });
    if (category === null)
      throw new InvalidTransactionError('Category unavailable.');
  }
  if (snapshot.subcategoryId != null) {
    await client.$queryRaw`SELECT id FROM categories WHERE id = ${snapshot.subcategoryId}::uuid AND owner_id = ${snapshot.ownerId}::uuid FOR SHARE`;
    const subcategory = await client.category.findFirst({
      where: {
        id: snapshot.subcategoryId,
        ownerId: snapshot.ownerId,
        parentCategoryId: snapshot.categoryId ?? null,
        ...(current?.subcategoryId === snapshot.subcategoryId
          ? {}
          : { archivedAt: null }),
      },
    });
    if (subcategory === null)
      throw new InvalidTransactionError('Subcategory unavailable.');
  }
  if (snapshot.costCenterId != null) {
    await client.$queryRaw`SELECT id FROM cost_centers WHERE id = ${snapshot.costCenterId}::uuid AND owner_id = ${snapshot.ownerId}::uuid FOR SHARE`;
    const center = await client.costCenter.findFirst({
      where: {
        id: snapshot.costCenterId,
        ownerId: snapshot.ownerId,
        ...(current?.costCenterId === snapshot.costCenterId
          ? {}
          : { archivedAt: null }),
      },
    });
    if (center === null)
      throw new InvalidTransactionError('Cost center unavailable.');
  }
  for (const tagId of [...(snapshot.tagIds ?? [])].sort()) {
    await client.$queryRaw`SELECT id FROM tags WHERE id = ${tagId}::uuid AND owner_id = ${snapshot.ownerId}::uuid FOR SHARE`;
    const tag = await client.tag.findFirst({
      where: { id: tagId, ownerId: snapshot.ownerId },
    });
    if (
      tag === null ||
      (tag.archivedAt !== null && !currentTagIds.includes(tagId))
    )
      throw new InvalidTransactionError('Tag unavailable.');
  }
}

async function validateCounterparty(
  client: Prisma.TransactionClient,
  ownerId: string,
  counterpartyId: string | null,
  previousId: string | null,
): Promise<void> {
  if (counterpartyId === null || counterpartyId === previousId) return;
  await client.$queryRaw`SELECT id FROM counterparties WHERE id = ${counterpartyId}::uuid AND owner_id = ${ownerId}::uuid FOR SHARE`;
  const counterparty = await client.counterparty.findFirst({
    where: { id: counterpartyId, ownerId, status: 'active' },
    select: { id: true },
  });
  if (counterparty === null)
    throw new InvalidTransactionError('Counterparty unavailable for new link.');
}

type PersistedTransaction = Exclude<
  Awaited<ReturnType<PrismaClient['transaction']['findFirst']>>,
  null
> & { tagAssignments?: readonly { tagId: string }[] };

export function restoreTransaction(row: PersistedTransaction): Transaction {
  return Transaction.restore({
    accountId: row.accountId,
    categoryId: row.categoryId,
    subcategoryId: row.subcategoryId,
    costCenterId: row.costCenterId,
    tagIds: row.tagAssignments?.map(({ tagId }) => tagId) ?? [],
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
    ...(row.eliminatedAt === null ? {} : { eliminatedAt: row.eliminatedAt }),
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
