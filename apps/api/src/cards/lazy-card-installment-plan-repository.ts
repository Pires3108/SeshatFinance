import type {
  CardInstallmentPlanRepository,
  CardInvoiceInstallment,
  CardInvoiceInstallmentReader,
  CardInstallmentPlanWrite,
  IdempotencyRequest,
} from '@seshat/application';
import type {
  CardInstallmentPlan,
  CardInvoice,
  CardPurchase,
} from '@seshat/domain';
import { PrismaCardInstallmentPlanRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyCardInstallmentPlanRepository
  implements CardInstallmentPlanRepository, CardInvoiceInstallmentReader
{
  private repository: PrismaCardInstallmentPlanRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public findPurchaseForOwner(
    purchaseId: string,
    ownerId: string,
  ): Promise<CardPurchase | null> {
    return this.getRepository().findPurchaseForOwner(purchaseId, ownerId);
  }

  public findPlanForPurchase(
    purchaseId: string,
    ownerId: string,
  ): Promise<CardInstallmentPlan | null> {
    return this.getRepository().findPlanForPurchase(purchaseId, ownerId);
  }

  public insertAtomically(
    request: IdempotencyRequest,
    invoices: readonly CardInvoice[],
    write: CardInstallmentPlanWrite,
  ): Promise<string> {
    return this.getRepository().insertAtomically(request, invoices, write);
  }

  public listForCycle(
    cardId: string,
    cycleClosesOn: string,
    ownerId: string,
  ): Promise<readonly CardInvoiceInstallment[]> {
    return this.getRepository().listForCycle(cardId, cycleClosesOn, ownerId);
  }

  private getRepository(): PrismaCardInstallmentPlanRepository {
    this.repository ??= new PrismaCardInstallmentPlanRepository(
      this.prisma.get(),
    );
    return this.repository;
  }
}
