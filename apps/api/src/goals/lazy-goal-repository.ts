import type {
  ExistingAccountShare,
  GoalRepository,
  GoalWrite,
  IdempotencyRequest,
} from '@seshat/application';
import type { Goal } from '@seshat/domain';
import { PrismaGoalRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyGoalRepository implements GoalRepository {
  private repository: PrismaGoalRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public findByIdForOwner(id: string, ownerId: string): Promise<Goal | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public listForOwner(ownerId: string): Promise<readonly Goal[]> {
    return this.getRepository().listForOwner(ownerId);
  }

  public listSharesForAccounts(
    ownerId: string,
    accountIds: readonly string[],
  ): Promise<readonly ExistingAccountShare[]> {
    return this.getRepository().listSharesForAccounts(ownerId, accountIds);
  }

  public insertAtomically(
    request: IdempotencyRequest,
    ownerId: string,
    accountIds: readonly string[],
    build: (shares: readonly ExistingAccountShare[]) => GoalWrite,
    serialize: (goal: Goal) => string,
  ): Promise<string> {
    return this.getRepository().insertAtomically(
      request,
      ownerId,
      accountIds,
      build,
      serialize,
    );
  }

  public saveAtomically(
    goalId: string,
    ownerId: string,
    expectedVersion: number,
    accountIds: readonly string[],
    build: (goal: Goal, shares: readonly ExistingAccountShare[]) => GoalWrite,
  ): Promise<Goal | null> {
    return this.getRepository().saveAtomically(
      goalId,
      ownerId,
      expectedVersion,
      accountIds,
      build,
    );
  }

  private getRepository(): PrismaGoalRepository {
    this.repository ??= new PrismaGoalRepository(this.prisma.get());
    return this.repository;
  }
}
