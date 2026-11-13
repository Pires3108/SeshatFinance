import type {
  CardPurchaseRepository,
  IdempotencyRequest,
  IdempotentCardPurchaseRecord,
} from '@seshat/application';
import type { CardPurchase, FinancialAuditEvent } from '@seshat/domain';
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
    purchase: CardPurchase,
    auditEvent: FinancialAuditEvent,
    idempotency: IdempotentCardPurchaseRecord,
  ): Promise<string> {
    return this.getRepository().insertAtomically(
      purchase,
      auditEvent,
      idempotency,
    );
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
