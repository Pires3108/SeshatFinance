import type {
  FinancialAuditChainVerification,
  FinancialAuditTrailEntry,
  FinancialAuditTrailQuery,
  FinancialAuditTrailRepository,
} from '@seshat/application';
import { PrismaFinancialAuditEventRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyFinancialAuditTrailRepository implements FinancialAuditTrailRepository {
  private repository: PrismaFinancialAuditEventRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public listForOwner(
    ownerId: string,
    query: FinancialAuditTrailQuery,
  ): Promise<readonly FinancialAuditTrailEntry[]> {
    return this.getRepository().listForOwner(ownerId, query);
  }

  public verifyChainForOwner(
    ownerId: string,
  ): Promise<FinancialAuditChainVerification> {
    return this.getRepository().verifyChainForOwner(ownerId);
  }

  private getRepository(): PrismaFinancialAuditEventRepository {
    this.repository ??= new PrismaFinancialAuditEventRepository(
      this.prisma.get(),
    );
    return this.repository;
  }
}
