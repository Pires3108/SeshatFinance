import type {
  IdempotencyRequest,
  IdempotentTransferRecord,
  TransferLifecycleRepository,
  TransferReadRepository,
  TransferRepository,
} from '@seshat/application';
import type {
  FinancialAuditEvent,
  Transfer,
  TransactionLifecycle,
} from '@seshat/domain';
import { PrismaTransferRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyTransferRepository
  implements
    TransferRepository,
    TransferLifecycleRepository,
    TransferReadRepository
{
  private repository: PrismaTransferRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public insertAtomically(
    transfer: Transfer,
    auditEvent: FinancialAuditEvent,
    idempotency: IdempotentTransferRecord,
  ): Promise<string> {
    return this.getRepository().insertAtomically(
      transfer,
      auditEvent,
      idempotency,
    );
  }

  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Transfer | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public listForOwner(
    ownerId: string,
    lifecycle?: TransactionLifecycle,
  ): Promise<readonly Transfer[]> {
    return this.getRepository().listForOwner(ownerId, lifecycle);
  }

  public saveAtomically(
    transfer: Transfer,
    expectedSourceVersion: number,
    expectedDestinationVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    return this.getRepository().saveAtomically(
      transfer,
      expectedSourceVersion,
      expectedDestinationVersion,
      auditEvent,
    );
  }

  private getRepository(): PrismaTransferRepository {
    this.repository ??= new PrismaTransferRepository(this.prisma.get());
    return this.repository;
  }
}
