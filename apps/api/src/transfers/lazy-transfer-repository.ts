import type {
  TransferLifecycleRepository,
  TransferRepository,
} from '@seshat/application';
import type { FinancialAuditEvent, Transfer } from '@seshat/domain';
import { PrismaTransferRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyTransferRepository
  implements TransferRepository, TransferLifecycleRepository
{
  private repository: PrismaTransferRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insertAtomically(
    transfer: Transfer,
    auditEvent: FinancialAuditEvent,
  ): Promise<void> {
    return this.getRepository().insertAtomically(transfer, auditEvent);
  }

  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Transfer | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
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
