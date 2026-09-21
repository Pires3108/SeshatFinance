import type {
  TransactionClassificationRepository,
  TransactionClassificationSelection,
} from '@seshat/application';
import { PrismaTransactionClassificationRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyTransactionClassificationRepository implements TransactionClassificationRepository {
  private repository: PrismaTransactionClassificationRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public getForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<TransactionClassificationSelection> {
    return this.getRepository().getForOwner(transactionId, ownerId);
  }

  public replaceForOwner(
    transactionId: string,
    ownerId: string,
    selection: TransactionClassificationSelection,
  ): ReturnType<TransactionClassificationRepository['replaceForOwner']> {
    return this.getRepository().replaceForOwner(
      transactionId,
      ownerId,
      selection,
    );
  }

  private getRepository(): PrismaTransactionClassificationRepository {
    this.repository ??= new PrismaTransactionClassificationRepository(
      this.prisma.get(),
    );
    return this.repository;
  }
}
