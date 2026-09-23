import type {
  BalanceAdjustmentHistoryItem,
  BalanceAdjustmentHistoryRepository,
  BalanceAdjustmentRepository,
} from '@seshat/application';
import type { BalanceAdjustment, FinancialAuditEvent } from '@seshat/domain';
import { PrismaBalanceAdjustmentRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyBalanceAdjustmentRepository
  implements BalanceAdjustmentRepository, BalanceAdjustmentHistoryRepository
{
  private repository: PrismaBalanceAdjustmentRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insertAtomically(
    adjustment: BalanceAdjustment,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    return this.getRepository().insertAtomically(adjustment, auditEvent);
  }

  public listForAccountOwner(
    accountId: string,
    ownerId: string,
  ): Promise<readonly BalanceAdjustmentHistoryItem[]> {
    return this.getRepository().listForAccountOwner(accountId, ownerId);
  }

  private getRepository(): PrismaBalanceAdjustmentRepository {
    this.repository ??= new PrismaBalanceAdjustmentRepository(
      this.prisma.get(),
    );
    return this.repository;
  }
}
