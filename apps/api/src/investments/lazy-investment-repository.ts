import type {
  IdempotencyRequest,
  InvestmentRepository,
  InvestmentWrite,
} from '@seshat/application';
import type { Investment } from '@seshat/domain';
import { PrismaInvestmentRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyInvestmentRepository implements InvestmentRepository {
  private repository: PrismaInvestmentRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Investment | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public listForOwner(ownerId: string): Promise<readonly Investment[]> {
    return this.getRepository().listForOwner(ownerId);
  }

  public insertAtomically(
    request: IdempotencyRequest,
    write: InvestmentWrite,
    serialize: (investment: Investment) => string,
  ): Promise<string> {
    return this.getRepository().insertAtomically(request, write, serialize);
  }

  public saveAtomically(
    id: string,
    ownerId: string,
    expectedVersion: number,
    build: (investment: Investment) => InvestmentWrite,
  ): Promise<Investment | null> {
    return this.getRepository().saveAtomically(
      id,
      ownerId,
      expectedVersion,
      build,
    );
  }

  private getRepository(): PrismaInvestmentRepository {
    this.repository ??= new PrismaInvestmentRepository(this.prisma.get());
    return this.repository;
  }
}
