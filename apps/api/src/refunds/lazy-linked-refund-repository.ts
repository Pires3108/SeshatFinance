import type {
  LinkedRefundDetails,
  LinkedRefundRecord,
  LinkedRefundRepository,
} from '@seshat/application';
import type { FinancialAuditEvent } from '@seshat/domain';
import { PrismaLinkedRefundRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyLinkedRefundRepository implements LinkedRefundRepository {
  private repository: PrismaLinkedRefundRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public record(
    record: LinkedRefundRecord,
    idempotencyKey: string,
    auditEvent: FinancialAuditEvent,
  ): Promise<LinkedRefundRecord> {
    return this.getRepository().record(record, idempotencyKey, auditEvent);
  }

  public getForExpense(
    expenseTransactionId: string,
    ownerId: string,
  ): Promise<LinkedRefundDetails | null> {
    return this.getRepository().getForExpense(expenseTransactionId, ownerId);
  }

  private getRepository(): PrismaLinkedRefundRepository {
    this.repository ??= new PrismaLinkedRefundRepository(this.prisma.get());
    return this.repository;
  }
}
