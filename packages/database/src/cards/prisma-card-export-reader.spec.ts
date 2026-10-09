import type { ExportFilters } from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaCardExportReader } from './prisma-card-export-reader.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const filters: ExportFilters = {
  from: null,
  to: null,
  accountIds: [accountId],
  categoryIds: [],
  entityIds: [],
  includeArchived: false,
  includeTrash: false,
  sets: ['credit_cards'],
};

describe('PrismaCardExportReader', () => {
  it('scopes payment account and renders the precise limit', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ownerId,
        paymentAccountId: accountId,
        name: 'Card',
        brand: 'Visa',
        limitMinorUnits: { toFixed: () => '123456789012345678901' },
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        closingDay: 10,
        dueDay: 17,
        createdAt: new Date('2026-10-07T00:00:00.000Z'),
      },
    ]);
    const reader = new PrismaCardExportReader({
      creditCard: { findMany },
    } as unknown as PrismaClient);
    expect(
      (await reader.readAuthorized(ownerId, filters, 'UTC'))[0],
    ).toMatchObject({
      payment_account_id: accountId,
      limit: { amount: '1234567890123456789.01', currency: 'BRL' },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId, paymentAccountId: { in: [accountId] } },
      }),
    );
  });
});
