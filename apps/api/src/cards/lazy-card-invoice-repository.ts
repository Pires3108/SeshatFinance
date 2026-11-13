import type {
  CardInvoiceRepository,
  CardInvoiceView,
} from '@seshat/application';
import type { CardInvoice, FinancialAuditEvent, Money } from '@seshat/domain';
import { PrismaCardInvoiceRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyCardInvoiceRepository implements CardInvoiceRepository {
  private repository: PrismaCardInvoiceRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public listForCard(
    cardId: string,
    ownerId: string,
  ): Promise<readonly CardInvoiceView[]> {
    return this.getRepository().listForCard(cardId, ownerId);
  }

  public findForCard(
    cardId: string,
    closesOn: string,
    ownerId: string,
  ): Promise<CardInvoiceView | null> {
    return this.getRepository().findForCard(cardId, closesOn, ownerId);
  }

  public closeAtomically(
    cardId: string,
    closesOn: string,
    ownerId: string,
    close: (
      invoice: CardInvoice,
      purchasesTotal: Money,
    ) => Readonly<{ invoice: CardInvoice; auditEvent: FinancialAuditEvent }>,
  ): Promise<CardInvoiceView | null> {
    return this.getRepository().closeAtomically(
      cardId,
      closesOn,
      ownerId,
      close,
    );
  }

  private getRepository(): PrismaCardInvoiceRepository {
    this.repository ??= new PrismaCardInvoiceRepository(this.prisma.get());
    return this.repository;
  }
}
