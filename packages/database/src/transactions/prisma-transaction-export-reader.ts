import type { ExportFilters, ExportRow } from '@seshat/application';
import { Currency, Money } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';
import {
  assertBoundedExportRows,
  EXPORT_QUERY_LIMIT,
} from '../exports/export-read-bounds.js';

export class PrismaTransactionExportReader {
  public constructor(private readonly client: PrismaClient) {}

  public async readAuthorized(
    ownerId: string,
    filters: ExportFilters,
    zone: string,
  ): Promise<readonly ExportRow[]> {
    const rows = await this.client.transaction.findMany({
      where: {
        ownerId,
        ...(filters.accountIds.length > 0
          ? { accountId: { in: [...filters.accountIds] } }
          : {}),
        ...(filters.categoryIds.length > 0
          ? {
              OR: [
                { categoryId: { in: [...filters.categoryIds] } },
                { subcategoryId: { in: [...filters.categoryIds] } },
              ],
            }
          : {}),
        lifecycle: {
          in: filters.includeTrash
            ? ['active', 'archived', 'trashed']
            : filters.includeArchived
              ? ['active', 'archived']
              : ['active'],
        },
      },
      select: {
        id: true,
        ownerId: true,
        accountId: true,
        categoryId: true,
        subcategoryId: true,
        costCenterId: true,
        tagAssignments: { select: { tagId: true }, orderBy: { tagId: 'asc' } },
        kind: true,
        amountMinorUnits: true,
        currencyCode: true,
        currencyMinorUnitScale: true,
        description: true,
        occurredAt: true,
        lifecycle: true,
        createdAt: true,
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: EXPORT_QUERY_LIMIT,
    });
    assertBoundedExportRows('transactions', rows);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return rows
      .filter((row) => {
        const parts = formatter.formatToParts(row.occurredAt);
        const year = parts.find((part) => part.type === 'year')?.value;
        const month = parts.find((part) => part.type === 'month')?.value;
        const day = parts.find((part) => part.type === 'day')?.value;
        if (year === undefined || month === undefined || day === undefined)
          throw new Error('Civil date could not be formatted.');
        const date = `${year}-${month}-${day}`;
        return (
          (filters.from === null || date >= filters.from) &&
          (filters.to === null || date <= filters.to)
        );
      })
      .map((row): ExportRow => ({
        id: row.id,
        ownerId: row.ownerId,
        account_id: row.accountId,
        category_id: row.categoryId,
        subcategory_id: row.subcategoryId,
        cost_center_id: row.costCenterId,
        tag_ids: row.tagAssignments.map((assignment) => assignment.tagId),
        kind: row.kind,
        amount: {
          amount: Money.fromMinorUnits(
            BigInt(row.amountMinorUnits.toFixed(0)),
            Currency.create(row.currencyCode, row.currencyMinorUnitScale),
          ).toDecimal(),
          currency: row.currencyCode,
        },
        description: row.description,
        occurred_at: row.occurredAt.toISOString(),
        lifecycle: row.lifecycle,
        created_at: row.createdAt.toISOString(),
      }));
  }
}
