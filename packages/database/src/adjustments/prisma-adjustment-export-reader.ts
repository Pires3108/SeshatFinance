import type { ExportFilters, ExportRow } from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';

function decimalFromMinorUnits(raw: string, scale: number): string {
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(scale + 1, '0');
  const amount =
    scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${amount}` : amount;
}

function civilDate(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: zone,
  }).formatToParts(instant);
  const value = (part: string): string =>
    parts.find((item) => item.type === part)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export class PrismaAdjustmentExportReader {
  public constructor(private readonly client: PrismaClient) {}

  public async readAuthorized(
    ownerId: string,
    filters: ExportFilters,
    zone: string,
  ): Promise<readonly ExportRow[]> {
    const rows = await this.client.balanceAdjustment.findMany({
      include: { transaction: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: {
        ownerId,
        ...(filters.accountIds.length > 0
          ? { accountId: { in: [...filters.accountIds] } }
          : {}),
      },
    });
    return rows
      .filter((row) => {
        const date = civilDate(row.transaction.occurredAt, zone);
        const lifecycle = row.transaction.lifecycle;
        return (
          (filters.from === null || date >= filters.from) &&
          (filters.to === null || date <= filters.to) &&
          (filters.includeTrash || lifecycle !== 'trashed') &&
          (filters.includeArchived || lifecycle !== 'archived')
        );
      })
      .map((row) => {
        const money = (raw: string): { amount: string; currency: string } => ({
          amount: decimalFromMinorUnits(raw, row.currencyMinorUnitScale),
          currency: row.currencyCode,
        });
        return {
          id: row.id,
          ownerId: row.ownerId,
          account_id: row.accountId,
          transaction_id: row.transactionId,
          previous_balance: money(row.previousBalanceMinorUnits.toFixed(0)),
          reported_balance: money(row.reportedBalanceMinorUnits.toFixed(0)),
          difference: money(row.differenceMinorUnits.toFixed(0)),
          occurred_at: row.transaction.occurredAt.toISOString(),
          created_at: row.createdAt.toISOString(),
        };
      });
  }
}
