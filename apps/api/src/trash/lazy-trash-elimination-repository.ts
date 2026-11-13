import type {
  TrashEliminationRepository,
  TrashEliminationTarget,
} from '@seshat/application';
import type {
  FinancialAuditEvent,
  Transaction,
  Transfer,
} from '@seshat/domain';
import { PrismaTrashEliminationRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyTrashEliminationRepository implements TrashEliminationRepository {
  private repository: PrismaTrashEliminationRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findExpiredTrash(
    cutoff: Date,
    limit: number,
  ): Promise<readonly TrashEliminationTarget[]> {
    return this.getRepository().findExpiredTrash(cutoff, limit);
  }

  public hasRetentionLinks(
    transactionId: string,
    ownerId: string,
  ): Promise<boolean> {
    return this.getRepository().hasRetentionLinks(transactionId, ownerId);
  }

  public eliminateTransaction(
    transaction: Transaction,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    return this.getRepository().eliminateTransaction(
      transaction,
      expectedVersion,
      auditEvent,
    );
  }

  public eliminateTransfer(
    transfer: Transfer,
    expectedSourceVersion: number,
    expectedDestinationVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    return this.getRepository().eliminateTransfer(
      transfer,
      expectedSourceVersion,
      expectedDestinationVersion,
      auditEvent,
    );
  }

  private getRepository(): PrismaTrashEliminationRepository {
    this.repository ??= new PrismaTrashEliminationRepository(this.prisma.get());
    return this.repository;
  }
}
