import type { CreditCardRepository } from '@seshat/application';
import {
  CARD_CLOSING_BOUNDARIES,
  CreditCard,
  type CardClosingBoundary,
  type FinancialAuditEvent,
} from '@seshat/domain';

import { insertFinancialAuditEvent } from '../audit/index.js';
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
          attentionDays: snapshot.attentionDays,
          closingBoundary: snapshot.closingBoundary,
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
          version: snapshot.version,
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

  public async update(
    card: CreditCard,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean> {
    const snapshot = card.toSnapshot();
    return this.client.$transaction(async (client) => {
      const result = await client.creditCard.updateMany({
        data: {
          brand: snapshot.brand,
          attentionDays: snapshot.attentionDays,
          closingBoundary: snapshot.closingBoundary,
          closingDay: snapshot.closingDay,
          dueDay: snapshot.dueDay,
          limitMinorUnits: card.limit.toMinorUnits().toString(),
          name: snapshot.name,
          version: snapshot.version,
        },
        where: {
          id: snapshot.id,
          ownerId: snapshot.ownerId,
          version: expectedVersion,
        },
      });
      if (result.count !== 1) return false;
      await insertFinancialAuditEvent(client, auditEvent);
      return true;
    });
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
    attentionDays: row.attentionDays,
    closingBoundary: parseClosingBoundary(row.closingBoundary),
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
    version: row.version,
  });
}

function parseClosingBoundary(value: string): CardClosingBoundary {
  const boundary = CARD_CLOSING_BOUNDARIES.find(
    (candidate) => candidate === value,
  );
  if (boundary === undefined) {
    throw new Error('Persisted credit card closing boundary is invalid.');
  }
  return boundary;
}
