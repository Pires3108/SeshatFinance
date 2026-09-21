import type {
  TransactionFinancialLinkRepository,
  TransactionRepository,
} from '@seshat/application';
import type { Transaction } from '@seshat/domain';
import { PrismaTransactionRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyTransactionRepository
  implements TransactionRepository, TransactionFinancialLinkRepository
{
  private repository: PrismaTransactionRepository | undefined;
  public constructor(private readonly prisma: LazyPrismaClient) {}
  public insert(transaction: Transaction): Promise<void> {
    return this.getRepository().insert(transaction);
  }
  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Transaction | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }
  public listForAccountOwner(
    accountId: string,
    ownerId: string,
  ): Promise<readonly Transaction[]> {
    return this.getRepository().listForAccountOwner(accountId, ownerId);
  }

  public listForOwnerBetween(
    ownerId: string,
    from: Date,
    to: Date,
  ): Promise<readonly Transaction[]> {
    return this.getRepository().listForOwnerBetween(ownerId, from, to);
  }
  public save(
    transaction: Transaction,
    expectedVersion: number,
  ): Promise<boolean> {
    return this.getRepository().save(transaction, expectedVersion);
  }

  public findTransferIdByEntryForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<string | null> {
    return this.getRepository().findTransferIdByEntryForOwner(
      transactionId,
      ownerId,
    );
  }
  private getRepository(): PrismaTransactionRepository {
    this.repository ??= new PrismaTransactionRepository(this.prisma.get());
    return this.repository;
  }
}
