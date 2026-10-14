import type {
  CardPurchaseRepository,
  RegisterCardPurchaseResult,
} from '@seshat/application';
import { CardPurchase, type FinancialAuditEvent } from '@seshat/domain';
import { CardPurchaseIdempotencyConflictError } from '@seshat/application';

import { insertFinancialAuditEvent } from '../audit/prisma-financial-audit-event-repository.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaCardPurchaseRepository implements CardPurchaseRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async register(
    purchase: CardPurchase,
    idempotencyKey: string,
    requestFingerprint: string,
    auditEvent: FinancialAuditEvent,
  ): Promise<RegisterCardPurchaseResult> {
    const snapshot = purchase.toSnapshot();
    try {
      await this.client.$transaction(async (transaction) => {
        await transaction.cardPurchase.create({
          data: {
            amountMinorUnits: purchase.amount.toMinorUnits().toString(),
            cardId: snapshot.cardId,
            createdAt: snapshot.createdAt,
            currencyCode: snapshot.amount.currency.code,
            currencyMinorUnitScale: snapshot.amount.currency.minorUnitScale,
            description: snapshot.description,
            externalId: snapshot.externalId,
            id: snapshot.id,
            idempotencyKey,
            occurredAt: snapshot.occurredAt,
            ownerId: snapshot.ownerId,
            requestFingerprint,
          },
        });
        await insertFinancialAuditEvent(transaction, auditEvent);
      });
      return { purchase, replayed: false };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.client.cardPurchase.findUnique({
        where: {
          ownerId_idempotencyKey: { ownerId: snapshot.ownerId, idempotencyKey },
        },
      });
      if (existing === null) throw error;
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new CardPurchaseIdempotencyConflictError();
      }
      return { purchase: restorePurchase(existing), replayed: true };
    }
  }
}

type PersistedPurchase = NonNullable<
  Awaited<ReturnType<PrismaClient['cardPurchase']['findFirst']>>
>;

function restorePurchase(row: PersistedPurchase): CardPurchase {
  const digits = row.amountMinorUnits
    .toFixed(0)
    .padStart(row.currencyMinorUnitScale + 1, '0');
  const amount =
    row.currencyMinorUnitScale === 0
      ? digits
      : `${digits.slice(0, -row.currencyMinorUnitScale)}.${digits.slice(-row.currencyMinorUnitScale)}`;
  return CardPurchase.restore({
    amount: {
      amount,
      currency: {
        code: row.currencyCode,
        minorUnitScale: row.currencyMinorUnitScale,
      },
    },
    cardId: row.cardId,
    createdAt: row.createdAt,
    description: row.description,
    externalId: row.externalId,
    id: row.id,
    occurredAt: row.occurredAt,
    ownerId: row.ownerId,
  });
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
