import type {
  IdempotencyRequest,
  InvestmentEventRepository,
  InvestmentEventWrite,
} from '@seshat/application';
import type { InvestmentEvent, Transaction } from '@seshat/domain';
import { PrismaInvestmentEventRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyInvestmentEventRepository implements InvestmentEventRepository {
  private repository: PrismaInvestmentEventRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public findByIdForOwner(
    eventId: string,
    ownerId: string,
  ): Promise<InvestmentEvent | null> {
    return this.getRepository().findByIdForOwner(eventId, ownerId);
  }

  public listForInvestment(
    investmentId: string,
    ownerId: string,
  ): Promise<readonly InvestmentEvent[]> {
    return this.getRepository().listForInvestment(investmentId, ownerId);
  }

  public recordAtomically(
    request: IdempotencyRequest,
    write: InvestmentEventWrite,
    response: string,
  ): Promise<string> {
    return this.getRepository().recordAtomically(request, write, response);
  }

  public changeAtomically(
    eventId: string,
    ownerId: string,
    expectedVersion: number,
    build: (
      event: InvestmentEvent,
      transaction: Transaction | null,
    ) => InvestmentEventWrite,
  ): Promise<InvestmentEvent | null> {
    return this.getRepository().changeAtomically(
      eventId,
      ownerId,
      expectedVersion,
      build,
    );
  }

  private getRepository(): PrismaInvestmentEventRepository {
    this.repository ??= new PrismaInvestmentEventRepository(this.prisma.get());
    return this.repository;
  }
}
