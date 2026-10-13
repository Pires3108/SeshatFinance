import {
  InvalidExportError,
  type AuthorizedExportReader,
  type ExportFilters,
  type ExportRow,
  type ExportSet,
} from '@seshat/application';

import { PrismaAccountExportReader } from '../accounts/prisma-account-export-reader.js';
import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';
import { PrismaAdjustmentExportReader } from '../adjustments/prisma-adjustment-export-reader.js';
import { PrismaCardExportReader } from '../cards/prisma-card-export-reader.js';
import {
  PrismaCategoryExportReader,
  PrismaCostCenterExportReader,
  PrismaTagExportReader,
} from '../classifications/prisma-classification-export-reader.js';
import { PrismaCategoryRepository } from '../classifications/prisma-category-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaTransactionExportReader } from '../transactions/prisma-transaction-export-reader.js';
import { PrismaTransferExportReader } from '../transfers/prisma-transfer-export-reader.js';

export interface ExportModuleReader {
  readAuthorized(
    ownerId: string,
    filters: ExportFilters,
    zone: string,
  ): Promise<readonly ExportRow[]>;
}

export interface OwnedExportSelectionLookup {
  findByIdForOwner(id: string, ownerId: string): Promise<object | null>;
}

export class ComposedAuthorizedExportReader implements AuthorizedExportReader {
  public constructor(
    private readonly accountLookup: OwnedExportSelectionLookup,
    private readonly categoryLookup: OwnedExportSelectionLookup,
    private readonly modules: Readonly<
      Partial<Record<ExportSet, ExportModuleReader>>
    >,
  ) {}

  public async assertAuthorizedSelection(
    actorId: string,
    filters: ExportFilters,
  ): Promise<void> {
    for (const id of filters.accountIds) {
      if ((await this.accountLookup.findByIdForOwner(id, actorId)) === null)
        throw new InvalidExportError('Selected account is unavailable.');
    }
    for (const id of filters.categoryIds) {
      if ((await this.categoryLookup.findByIdForOwner(id, actorId)) === null)
        throw new InvalidExportError('Selected category is unavailable.');
    }
    for (const set of filters.sets) {
      if (this.modules[set] === undefined)
        throw new InvalidExportError(`Export set ${set} is unavailable.`);
    }
  }

  public readAuthorized(
    set: ExportSet,
    actorId: string,
    filters: ExportFilters,
    zone: string,
  ): Promise<readonly ExportRow[]> {
    const reader = this.modules[set];
    if (reader === undefined)
      throw new InvalidExportError(`Export set ${set} is unavailable.`);
    return reader.readAuthorized(actorId, filters, zone);
  }
}

export function createAuthorizedExportReader(
  client: PrismaClient,
): AuthorizedExportReader {
  return new ComposedAuthorizedExportReader(
    new PrismaAccountRepository(client),
    new PrismaCategoryRepository(client),
    {
      accounts: new PrismaAccountExportReader(client),
      transactions: new PrismaTransactionExportReader(client),
      transfers: new PrismaTransferExportReader(client),
      balance_adjustments: new PrismaAdjustmentExportReader(client),
      categories: new PrismaCategoryExportReader(client),
      tags: new PrismaTagExportReader(client),
      cost_centers: new PrismaCostCenterExportReader(client),
      credit_cards: new PrismaCardExportReader(client),
    },
  );
}
