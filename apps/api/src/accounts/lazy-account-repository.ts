import type { AccountRepository } from '@seshat/application';
import type { Account } from '@seshat/domain';
import { PrismaAccountRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyAccountRepository implements AccountRepository {
  private repository: PrismaAccountRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insert(account: Account): Promise<void> {
    return this.getRepository().insert(account);
  }

  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Account | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public save(account: Account, expectedVersion: number): Promise<boolean> {
    return this.getRepository().save(account, expectedVersion);
  }

  private getRepository(): PrismaAccountRepository {
    this.repository ??= new PrismaAccountRepository(this.prisma.get());
    return this.repository;
  }
}
