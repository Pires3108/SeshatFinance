import type { ExportFilters } from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaTransferExportReader } from './prisma-transfer-export-reader.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const filters: ExportFilters = {
  from: '2026-10-07',
  to: '2026-10-07',
  accountIds: [],
  categoryIds: [],
  entityIds: [],
  includeArchived: false,
  includeTrash: false,
  sets: ['transfers'],
};

describe('PrismaTransferExportReader', () => {
  it('scopes the query to the owner and filters by the source civil day', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ownerId,
        sourceTransactionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        destinationTransactionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        createdAt: new Date('2026-10-07T01:00:00.000Z'),
        sourceTransaction: {
          occurredAt: new Date('2026-10-07T02:59:00.000Z'),
          lifecycle: 'active',
        },
        destinationTransaction: {
          accountId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        },
      },
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        ownerId,
        sourceTransactionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        destinationTransactionId: 'abababab-abab-4aba-8aba-abababababab',
        createdAt: new Date('2026-10-07T03:00:00.000Z'),
        sourceTransaction: {
          occurredAt: new Date('2026-10-07T03:00:00.000Z'),
          lifecycle: 'active',
        },
        destinationTransaction: {
          accountId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        },
      },
    ]);
    const reader = new PrismaTransferExportReader({
      transfer: { findMany },
    } as unknown as PrismaClient);
    const rows = await reader.readAuthorized(
      ownerId,
      filters,
      'America/Sao_Paulo',
    );
    expect(rows.map((row) => row.id)).toEqual([
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId } }),
    );
    expect(rows[0]).toMatchObject({
      source_transaction_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      destination_transaction_id: 'abababab-abab-4aba-8aba-abababababab',
    });
  });

  it('requires both transfer legs in the selected accounts', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const reader = new PrismaTransferExportReader({
      transfer: { findMany },
    } as unknown as PrismaClient);
    await reader.readAuthorized(
      ownerId,
      { ...filters, accountIds: ['11111111-1111-4111-8111-111111111111'] },
      'UTC',
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId,
          AND: [
            {
              sourceTransaction: {
                accountId: { in: ['11111111-1111-4111-8111-111111111111'] },
              },
            },
            {
              destinationTransaction: {
                accountId: { in: ['11111111-1111-4111-8111-111111111111'] },
              },
            },
          ],
        },
      }),
    );
  });
});
