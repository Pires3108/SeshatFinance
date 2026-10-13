import type { ExportFilters, ExportRow } from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';

function decimalFromMinorUnits(raw: string, scale: number): string {
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(scale + 1, '0');
  const amount =
    scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${amount}` : amount;
}

export class PrismaCardExportReader {
  public constructor(private readonly client: PrismaClient) {}

  public async readAuthorized(
    ownerId: string,
    filters: ExportFilters,
    _zone: string,
  ): Promise<readonly ExportRow[]> {
    new Intl.DateTimeFormat('en-US', { timeZone: _zone });
    const rows = await this.client.creditCard.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: {
        ownerId,
        ...(filters.accountIds.length > 0
          ? { paymentAccountId: { in: [...filters.accountIds] } }
          : {}),
      },
    });
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      brand: row.brand,
      payment_account_id: row.paymentAccountId,
      limit: {
        amount: decimalFromMinorUnits(
          row.limitMinorUnits.toFixed(0),
          row.currencyMinorUnitScale,
        ),
        currency: row.currencyCode,
      },
      closing_day: row.closingDay,
      due_day: row.dueDay,
      created_at: row.createdAt.toISOString(),
    }));
  }
}
