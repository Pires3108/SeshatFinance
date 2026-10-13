import type { ExportFilters } from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaAdjustmentExportReader } from './prisma-adjustment-export-reader.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const filters: ExportFilters = {
  from: null,
  to: null,
  accountIds: ['22222222-2222-4222-8222-222222222222'],
  categoryIds: [],
  entityIds: [],
  includeArchived: false,
  includeTrash: false,
  sets: ['balance_adjustments'],
};

describe('PrismaAdjustmentExportReader', () => {
  it('exports signed decimal money with currency and scopes the account', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ownerId,
        accountId: filters.accountIds[0],
        transactionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        previousBalanceMinorUnits: { toFixed: () => '100000000000000000001' },
        reportedBalanceMinorUnits: { toFixed: () => '99999999999999999999' },
        differenceMinorUnits: { toFixed: () => '-2' },
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        transaction: {
          occurredAt: new Date('2026-10-07T03:00:00.000Z'),
          lifecycle: 'active',
        },
        createdAt: new Date('2026-10-07T03:00:00.000Z'),
      },
    ]);
    const reader = new PrismaAdjustmentExportReader({
      balanceAdjustment: { findMany },
    } as unknown as PrismaClient);
    const rows = await reader.readAuthorized(
      ownerId,
      filters,
      'America/Sao_Paulo',
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId, accountId: { in: [...filters.accountIds] } },
      }),
    );
    expect(rows[0]).toMatchObject({
      previous_balance: { amount: '1000000000000000000.01', currency: 'BRL' },
      reported_balance: { amount: '999999999999999999.99', currency: 'BRL' },
      difference: { amount: '-0.02', currency: 'BRL' },
    });
  });
});
