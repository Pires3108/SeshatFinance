import type { ExportFilters, ExportRow } from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';

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

export class PrismaTransferExportReader {
  public constructor(private readonly client: PrismaClient) {}

  public async readAuthorized(
    ownerId: string,
    filters: ExportFilters,
    zone: string,
  ): Promise<readonly ExportRow[]> {
    const rows = await this.client.transfer.findMany({
      include: { sourceTransaction: true, destinationTransaction: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: {
        ownerId,
        ...(filters.accountIds.length > 0
          ? {
              AND: [
                {
                  sourceTransaction: {
                    accountId: { in: [...filters.accountIds] },
                  },
                },
                {
                  destinationTransaction: {
                    accountId: { in: [...filters.accountIds] },
                  },
                },
              ],
            }
          : {}),
      },
    });
    return rows
      .filter((row) => {
        const date = civilDate(row.sourceTransaction.occurredAt, zone);
        const lifecycle = row.sourceTransaction.lifecycle;
        return (
          (filters.from === null || date >= filters.from) &&
          (filters.to === null || date <= filters.to) &&
          (filters.includeTrash || lifecycle !== 'trashed') &&
          (filters.includeArchived || lifecycle !== 'archived')
        );
      })
      .map((row) => ({
        id: row.id,
        ownerId: row.ownerId,
        source_transaction_id: row.sourceTransactionId,
        destination_transaction_id: row.destinationTransactionId,
        created_at: row.createdAt.toISOString(),
      }));
  }
}
