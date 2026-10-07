import type { ExportFilters, ExportRow } from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';
import {
  assertBoundedExportRows,
  EXPORT_QUERY_LIMIT,
} from '../exports/export-read-bounds.js';

export class PrismaCategoryExportReader {
  public constructor(private readonly client: PrismaClient) {}

  public async readAuthorized(
    ownerId: string,
    filters: ExportFilters,
    _zone: string,
  ): Promise<readonly ExportRow[]> {
    new Intl.DateTimeFormat('en-US', { timeZone: _zone });
    const rows = await this.client.category.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: { ownerId },
      take: EXPORT_QUERY_LIMIT,
    });
    assertBoundedExportRows('categories', rows);
    const selected = new Set(filters.categoryIds);
    if (selected.size > 0) {
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const id of filters.categoryIds) {
        let current = byId.get(id);
        while (current?.parentCategoryId !== null && current !== undefined) {
          const parentId: string = current.parentCategoryId;
          if (selected.has(parentId)) break;
          selected.add(parentId);
          current = byId.get(parentId);
        }
      }
    }
    return rows
      .filter((row) => selected.size === 0 || selected.has(row.id))
      .map((row) => ({
        id: row.id,
        ownerId: row.ownerId,
        name: row.name,
        parent_category_id: row.parentCategoryId,
        created_at: row.createdAt.toISOString(),
      }));
  }
}

export class PrismaTagExportReader {
  public constructor(private readonly client: PrismaClient) {}

  public async readAuthorized(
    ownerId: string,
    _filters: ExportFilters,
    _zone: string,
  ): Promise<readonly ExportRow[]> {
    if (_filters.entityIds.length > 0)
      throw new Error('Entity filters are unsupported.');
    new Intl.DateTimeFormat('en-US', { timeZone: _zone });
    const rows = await this.client.tag.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: { ownerId },
      take: EXPORT_QUERY_LIMIT,
    });
    assertBoundedExportRows('tags', rows);
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      created_at: row.createdAt.toISOString(),
    }));
  }
}

export class PrismaCostCenterExportReader {
  public constructor(private readonly client: PrismaClient) {}

  public async readAuthorized(
    ownerId: string,
    _filters: ExportFilters,
    _zone: string,
  ): Promise<readonly ExportRow[]> {
    if (_filters.entityIds.length > 0)
      throw new Error('Entity filters are unsupported.');
    new Intl.DateTimeFormat('en-US', { timeZone: _zone });
    const rows = await this.client.costCenter.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: { ownerId },
      take: EXPORT_QUERY_LIMIT,
    });
    assertBoundedExportRows('cost_centers', rows);
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      created_at: row.createdAt.toISOString(),
    }));
  }
}
