import type { ManualExchangeQuoteRepository } from '@seshat/application';
import type { FinancialAuditEvent, ManualExchangeQuote } from '@seshat/domain';
import { PrismaManualExchangeQuoteRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyManualExchangeQuoteRepository implements ManualExchangeQuoteRepository {
  private repository: PrismaManualExchangeQuoteRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insertVersion(
    quote: ManualExchangeQuote,
    auditEvent: FinancialAuditEvent,
    idempotencyKey: string,
  ): Promise<boolean> {
    return this.getRepository().insertVersion(
      quote,
      auditEvent,
      idempotencyKey,
    );
  }

  public findByIdempotencyKeyForOwner(
    ownerId: string,
    action: 'created' | 'updated',
    idempotencyKey: string,
  ): Promise<ManualExchangeQuote | null> {
    return this.getRepository().findByIdempotencyKeyForOwner(
      ownerId,
      action,
      idempotencyKey,
    );
  }

  public findLatestForOwner(
    id: string,
    ownerId: string,
  ): Promise<ManualExchangeQuote | null> {
    return this.getRepository().findLatestForOwner(id, ownerId);
  }

  public listLatestForOwner(
    ownerId: string,
  ): Promise<readonly ManualExchangeQuote[]> {
    return this.getRepository().listLatestForOwner(ownerId);
  }

  private getRepository(): PrismaManualExchangeQuoteRepository {
    this.repository ??= new PrismaManualExchangeQuoteRepository(
      this.prisma.get(),
    );
    return this.repository;
  }
}
