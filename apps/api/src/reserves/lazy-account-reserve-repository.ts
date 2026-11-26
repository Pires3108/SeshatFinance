import type {
  AccountReserveRepository,
  AccountReserveWrite,
  IdempotencyRequest,
} from '@seshat/application';
import type { AccountReserve } from '@seshat/domain';
import { PrismaAccountReserveRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyAccountReserveRepository implements AccountReserveRepository {
  private repository: PrismaAccountReserveRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public findForOwner(
    accountId: string,
    ownerId: string,
  ): Promise<AccountReserve | null> {
    return this.getRepository().findForOwner(accountId, ownerId);
  }

  public listForOwner(ownerId: string): Promise<readonly AccountReserve[]> {
    return this.getRepository().listForOwner(ownerId);
  }

  public saveAtomically(
    request: IdempotencyRequest,
    accountId: string,
    expectedVersion: number,
    build: (current: AccountReserve | null) => AccountReserveWrite,
    serialize: (reserve: AccountReserve) => string,
  ): Promise<string> {
    return this.getRepository().saveAtomically(
      request,
      accountId,
      expectedVersion,
      build,
      serialize,
    );
  }

  private getRepository(): PrismaAccountReserveRepository {
    this.repository ??= new PrismaAccountReserveRepository(this.prisma.get());
    return this.repository;
  }
}
