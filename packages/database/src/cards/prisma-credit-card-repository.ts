import type { CreditCardRepository } from '@seshat/application';
import type { CreditCard, FinancialAuditEvent } from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/prisma-financial-audit-event-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaCreditCardRepository implements CreditCardRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(
    card: CreditCard,
    auditEvent: FinancialAuditEvent,
  ): Promise<void> {
    const snapshot = card.toSnapshot();
    await this.client.$transaction(async (client) => {
      await client.creditCard.create({
        data: {
          brand: snapshot.brand,
          closingDay: snapshot.closingDay,
          createdAt: snapshot.createdAt,
          currencyCode: snapshot.limit.currency.code,
          currencyMinorUnitScale: snapshot.limit.currency.minorUnitScale,
          dueDay: snapshot.dueDay,
          id: snapshot.id,
          limitMinorUnits: card.limit.toMinorUnits().toString(),
          name: snapshot.name,
          ownerId: snapshot.ownerId,
          paymentAccountId: snapshot.paymentAccountId,
        },
      });
      await insertFinancialAuditEvent(client, auditEvent);
    });
  }
}
