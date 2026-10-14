import type {
  CardPurchaseRepository,
  RegisterCardPurchaseResult,
} from '@seshat/application';
import type { CardPurchase, FinancialAuditEvent } from '@seshat/domain';
import { PrismaCardPurchaseRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyCardPurchaseRepository implements CardPurchaseRepository {
  private repository: PrismaCardPurchaseRepository | undefined;
  public constructor(private readonly prisma: LazyPrismaClient) {}

  public register(
    purchase: CardPurchase,
    idempotencyKey: string,
    requestFingerprint: string,
    auditEvent: FinancialAuditEvent,
  ): Promise<RegisterCardPurchaseResult> {
    this.repository ??= new PrismaCardPurchaseRepository(this.prisma.get());
    return this.repository.register(
      purchase,
      idempotencyKey,
      requestFingerprint,
      auditEvent,
    );
  }
}
