import type { TransactionTagRepository } from '@seshat/application';
import { PrismaTransactionTagRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';
import type { FinancialAuditEvent } from '@seshat/domain';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyTransactionTagRepository implements TransactionTagRepository {
  private repository: PrismaTransactionTagRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public listTagIdsForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<readonly string[]> {
    return this.getRepository().listTagIdsForOwner(transactionId, ownerId);
  }

  public replaceForOwner(
    transactionId: string,
    ownerId: string,
    tagIds: readonly string[],
    auditEvent: FinancialAuditEvent,
  ): ReturnType<TransactionTagRepository['replaceForOwner']> {
    return this.getRepository().replaceForOwner(
      transactionId,
      ownerId,
      tagIds,
      auditEvent,
    );
  }

  private getRepository(): PrismaTransactionTagRepository {
    this.repository ??= new PrismaTransactionTagRepository(this.prisma.get());
    return this.repository;
  }
}
