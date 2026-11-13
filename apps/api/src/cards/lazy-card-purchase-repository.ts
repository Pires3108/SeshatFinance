import type {
  CardPurchaseRepository,
  CardPurchaseWrite,
  IdempotencyRequest,
} from '@seshat/application';
import type { CardInvoice, CardPurchase } from '@seshat/domain';
import { PrismaCardPurchaseRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyCardPurchaseRepository implements CardPurchaseRepository {
  private repository: PrismaCardPurchaseRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public insertAtomically(
    request: IdempotencyRequest,
    candidates: readonly CardInvoice[],
    build: (
      invoice: CardInvoice,
      postedAfterClose: boolean,
    ) => CardPurchaseWrite,
  ): Promise<string> {
    return this.getRepository().insertAtomically(request, candidates, build);
  }

  public listForCard(
    cardId: string,
    ownerId: string,
    cycleClosesOn?: string,
  ): Promise<readonly CardPurchase[]> {
    return this.getRepository().listForCard(cardId, ownerId, cycleClosesOn);
  }

  private getRepository(): PrismaCardPurchaseRepository {
    this.repository ??= new PrismaCardPurchaseRepository(this.prisma.get());
    return this.repository;
  }
}
