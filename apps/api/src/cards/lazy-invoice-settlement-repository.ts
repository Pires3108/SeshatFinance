import type {
  IdempotencyRequest,
  InvoiceSettlementReader,
  InvoiceSettlementRepository,
  InvoiceSettlementWrite,
} from '@seshat/application';
import type { InvoiceSettlement } from '@seshat/domain';
import { PrismaInvoiceSettlementRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyInvoiceSettlementRepository
  implements InvoiceSettlementRepository, InvoiceSettlementReader
{
  private repository: PrismaInvoiceSettlementRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public settleAtomically(
    request: IdempotencyRequest,
    cardId: string,
    invoiceClosesOn: string,
    write: InvoiceSettlementWrite,
  ): Promise<string | null> {
    return this.getRepository().settleAtomically(
      request,
      cardId,
      invoiceClosesOn,
      write,
    );
  }

  public listForInvoice(
    cardId: string,
    invoiceClosesOn: string,
    ownerId: string,
  ): Promise<readonly InvoiceSettlement[]> {
    return this.getRepository().listForInvoice(
      cardId,
      invoiceClosesOn,
      ownerId,
    );
  }

  private getRepository(): PrismaInvoiceSettlementRepository {
    this.repository ??= new PrismaInvoiceSettlementRepository(
      this.prisma.get(),
    );
    return this.repository;
  }
}
