import { MAX_EXPORT_ROWS, type ExportFilters } from '@seshat/application';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import {
  PrismaCategoryExportReader,
  PrismaCostCenterExportReader,
  PrismaTagExportReader,
} from './prisma-classification-export-reader.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const parent = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const child = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const filters: ExportFilters = {
  from: null,
  to: null,
  accountIds: [],
  categoryIds: [child],
  entityIds: [],
  includeArchived: false,
  includeTrash: false,
  sets: ['categories', 'tags', 'cost_centers'],
};

describe('PrismaClassificationExportReaders', () => {
  it('keeps parent categories needed to interpret a selected child', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: parent,
        ownerId,
        name: 'Parent',
        parentCategoryId: null,
        createdAt: new Date('2026-01-01Z'),
      },
      {
        id: child,
        ownerId,
        name: 'Child',
        parentCategoryId: parent,
        createdAt: new Date('2026-01-02Z'),
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ownerId,
        name: 'Other',
        parentCategoryId: null,
        createdAt: new Date('2026-01-03Z'),
      },
    ]);
    const reader = new PrismaCategoryExportReader({
      category: { findMany },
    } as unknown as PrismaClient);
    expect(
      (await reader.readAuthorized(ownerId, filters, 'UTC')).map(
        (row) => row.id,
      ),
    ).toEqual([parent, child]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId } }),
    );
  });

  it('exports tags and cost centers without truncating queries', async () => {
    const row = {
      id: parent,
      ownerId,
      name: 'Name',
      createdAt: new Date('2026-01-01Z'),
    };
    const tagFindMany = vi.fn().mockResolvedValue([row]);
    const centerFindMany = vi.fn().mockResolvedValue([row]);
    const client = {
      tag: { findMany: tagFindMany },
      costCenter: { findMany: centerFindMany },
    } as unknown as PrismaClient;
    expect(
      await new PrismaTagExportReader(client).readAuthorized(
        ownerId,
        filters,
        'UTC',
      ),
    ).toHaveLength(1);
    expect(
      await new PrismaCostCenterExportReader(client).readAuthorized(
        ownerId,
        filters,
        'UTC',
      ),
    ).toHaveLength(1);
    expect(tagFindMany.mock.calls[0]?.[0]).toMatchObject({ take: 100_001 });
    expect(centerFindMany.mock.calls[0]?.[0]).toMatchObject({ take: 100_001 });
  });

  it('rejects an oversized result after a bounded sentinel query', async () => {
    const findMany = vi.fn().mockResolvedValue(
      Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, index) => ({
        id: `id-${String(index)}`,
        ownerId,
        name: 'Name',
        parentCategoryId: null,
        createdAt: new Date('2026-01-01Z'),
      })),
    );
    const reader = new PrismaCategoryExportReader({
      category: { findMany },
    } as unknown as PrismaClient);

    await expect(
      reader.readAuthorized(ownerId, filters, 'UTC'),
    ).rejects.toThrow('exceeds the row limit');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: MAX_EXPORT_ROWS + 1 }),
    );
  });
});
