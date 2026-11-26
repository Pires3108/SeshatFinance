import type {
  BudgetRepository,
  BudgetWrite,
  IdempotencyRequest,
} from '@seshat/application';
import type { Budget } from '@seshat/domain';
import { PrismaBudgetRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyBudgetRepository implements BudgetRepository {
  private repository: PrismaBudgetRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public findByIdForOwner(id: string, ownerId: string): Promise<Budget | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public listForOwner(ownerId: string): Promise<readonly Budget[]> {
    return this.getRepository().listForOwner(ownerId);
  }

  public insertAtomically(
    request: IdempotencyRequest,
    write: BudgetWrite,
    serialize: (budget: Budget) => string,
  ): Promise<string> {
    return this.getRepository().insertAtomically(request, write, serialize);
  }

  public saveAtomically(
    id: string,
    ownerId: string,
    expectedVersion: number,
    build: (budget: Budget) => BudgetWrite,
  ): Promise<Budget | null> {
    return this.getRepository().saveAtomically(
      id,
      ownerId,
      expectedVersion,
      build,
    );
  }

  private getRepository(): PrismaBudgetRepository {
    this.repository ??= new PrismaBudgetRepository(this.prisma.get());
    return this.repository;
  }
}
