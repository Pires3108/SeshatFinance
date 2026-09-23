import type { CreditCardRepository } from '@seshat/application';
import type { CreditCard, FinancialAuditEvent } from '@seshat/domain';
import { PrismaCreditCardRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyCreditCardRepository implements CreditCardRepository {
  private repository: PrismaCreditCardRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insert(
    card: CreditCard,
    auditEvent: FinancialAuditEvent,
  ): Promise<void> {
    return this.getRepository().insert(card, auditEvent);
  }

  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<CreditCard | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public listForOwner(ownerId: string): Promise<readonly CreditCard[]> {
    return this.getRepository().listForOwner(ownerId);
  }

  private getRepository(): PrismaCreditCardRepository {
    this.repository ??= new PrismaCreditCardRepository(this.prisma.get());
    return this.repository;
  }
}
