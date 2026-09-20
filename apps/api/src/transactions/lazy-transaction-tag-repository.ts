import type { TransactionTagRepository } from '@seshat/application';
import { PrismaTransactionTagRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

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
  ): ReturnType<TransactionTagRepository['replaceForOwner']> {
    return this.getRepository().replaceForOwner(transactionId, ownerId, tagIds);
  }

  private getRepository(): PrismaTransactionTagRepository {
    this.repository ??= new PrismaTransactionTagRepository(this.prisma.get());
    return this.repository;
  }
}
