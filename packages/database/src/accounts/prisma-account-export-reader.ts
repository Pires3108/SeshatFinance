import type { ExportFilters, ExportRow } from '@seshat/application';
import { Currency, Money } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';
import {
  assertBoundedExportRows,
  EXPORT_QUERY_LIMIT,
} from '../exports/export-read-bounds.js';

export class PrismaAccountExportReader {
  public constructor(private readonly client: PrismaClient) {}

  public async readAuthorized(
    ownerId: string,
    filters: ExportFilters,
  ): Promise<readonly ExportRow[]> {
    const rows = await this.client.account.findMany({
      where: {
        ownerId,
        ...(filters.accountIds.length > 0
          ? { id: { in: [...filters.accountIds] } }
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
        name: true,
        typeKey: true,
        institution: true,
        initialBalanceMinorUnits: true,
        currencyCode: true,
        currencyMinorUnitScale: true,
        lifecycle: true,
        createdAt: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: EXPORT_QUERY_LIMIT,
    });
    assertBoundedExportRows('accounts', rows);
    return rows.map((row): ExportRow => ({
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      type: row.typeKey,
      institution: row.institution,
      initial_balance: {
        amount: Money.fromMinorUnits(
          BigInt(row.initialBalanceMinorUnits.toFixed(0)),
          Currency.create(row.currencyCode, row.currencyMinorUnitScale),
        ).toDecimal(),
        currency: row.currencyCode,
      },
      lifecycle: row.lifecycle,
      created_at: row.createdAt.toISOString(),
    }));
  }
}
