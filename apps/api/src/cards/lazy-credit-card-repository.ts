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

  private getRepository(): PrismaCreditCardRepository {
    this.repository ??= new PrismaCreditCardRepository(this.prisma.get());
    return this.repository;
  }
}
