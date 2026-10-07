import type {
  ExportAuthorizationPort,
  ExportFilters,
} from '@seshat/application';
import { createAuthorizedExportReader } from '@seshat/database';
import { Injectable } from '@nestjs/common';
import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyExportAuthorization implements ExportAuthorizationPort {
  public constructor(private readonly prisma: LazyPrismaClient) {}

  public async assertCanExport(
    actorId: string,
    filters: ExportFilters,
    zone: string,
  ): Promise<void> {
    await createAuthorizedExportReader(
      this.prisma.get(),
    ).assertAuthorizedSelection(actorId, filters, zone);
  }
}
