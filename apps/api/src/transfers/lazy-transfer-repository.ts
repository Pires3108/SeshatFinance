import type { TransferRepository } from '@seshat/application';
import type { Transfer } from '@seshat/domain';
import { PrismaTransferRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyTransferRepository implements TransferRepository {
  private repository: PrismaTransferRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insertAtomically(transfer: Transfer): Promise<void> {
    return this.getRepository().insertAtomically(transfer);
  }

  private getRepository(): PrismaTransferRepository {
    this.repository ??= new PrismaTransferRepository(this.prisma.get());
    return this.repository;
  }
}
