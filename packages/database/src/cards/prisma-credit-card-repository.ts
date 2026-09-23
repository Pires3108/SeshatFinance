import type { CreditCardRepository } from '@seshat/application';
import { CreditCard, type FinancialAuditEvent } from '@seshat/domain';

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

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<CreditCard | null> {
    const row = await this.client.creditCard.findFirst({
      where: { id, ownerId },
    });
    return row === null ? null : restoreCard(row);
  }

  public async listForOwner(ownerId: string): Promise<readonly CreditCard[]> {
    const rows = await this.client.creditCard.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      where: { ownerId },
    });
    return rows.map(restoreCard);
  }
}

type PersistedCard = NonNullable<
  Awaited<ReturnType<PrismaClient['creditCard']['findFirst']>>
>;

function restoreCard(row: PersistedCard): CreditCard {
  const digits = row.limitMinorUnits
    .toFixed(0)
    .padStart(row.currencyMinorUnitScale + 1, '0');
  const amount =
    row.currencyMinorUnitScale === 0
      ? digits
      : `${digits.slice(0, -row.currencyMinorUnitScale)}.${digits.slice(-row.currencyMinorUnitScale)}`;
  return CreditCard.restore({
    brand: row.brand,
    closingDay: row.closingDay,
    createdAt: row.createdAt,
    dueDay: row.dueDay,
    id: row.id,
    limit: {
      amount,
      currency: {
        code: row.currencyCode,
        minorUnitScale: row.currencyMinorUnitScale,
      },
    },
    name: row.name,
    ownerId: row.ownerId,
    paymentAccountId: row.paymentAccountId,
  });
}
