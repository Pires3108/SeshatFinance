import { createHash } from 'node:crypto';

import {
  CardPurchase,
  Currency,
  FinancialAuditEvent,
  Money,
} from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import type { CreditCardRepository } from './create-credit-card.js';

export type RegisterCardPurchaseCommand = Readonly<{
  actorId: string;
  amount: string;
  cardId: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string;
  externalId?: string | null | undefined;
  idempotencyKey: string;
  occurredAt: Date;
}>;

export type RegisterCardPurchaseResult = Readonly<{
  purchase: CardPurchase;
  replayed: boolean;
}>;

export interface CardPurchaseRepository {
  register(
    purchase: CardPurchase,
    idempotencyKey: string,
    requestFingerprint: string,
    auditEvent: FinancialAuditEvent,
  ): Promise<RegisterCardPurchaseResult>;
}

export class OwnedCreditCardNotFoundError extends Error {
  public constructor() {
    super('Owned credit card was not found.');
    this.name = 'OwnedCreditCardNotFoundError';
  }
}

export class CardPurchaseCurrencyMismatchError extends Error {
  public constructor() {
    super('Card purchase currency must match the credit card currency.');
    this.name = 'CardPurchaseCurrencyMismatchError';
  }
}

export class InvalidCardPurchaseIdempotencyKeyError extends Error {
  public constructor() {
    super('Card purchase idempotency key is required.');
    this.name = 'InvalidCardPurchaseIdempotencyKeyError';
  }
}

export class CardPurchaseIdempotencyConflictError extends Error {
  public constructor() {
    super('Idempotency key was already used for a different card purchase.');
    this.name = 'CardPurchaseIdempotencyConflictError';
  }
}

export class RegisterCardPurchaseUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly purchases: CardPurchaseRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: RegisterCardPurchaseCommand,
  ): Promise<RegisterCardPurchaseResult> {
    if (command.idempotencyKey.trim().length === 0) {
      throw new InvalidCardPurchaseIdempotencyKeyError();
    }
    const card = await this.cards.findByIdForOwner(
      command.cardId,
      command.actorId,
    );
    if (card === null) throw new OwnedCreditCardNotFoundError();
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    if (!currency.equals(card.limit.currency))
      throw new CardPurchaseCurrencyMismatchError();

    const amount = Money.fromDecimal(command.amount, currency);
    const at = this.clock.now();
    const purchase = CardPurchase.create({
      amount,
      cardId: card.id,
      createdAt: at,
      description: command.description,
      externalId: command.externalId,
      id: this.identifiers.generate(),
      occurredAt: command.occurredAt,
      ownerId: command.actorId,
    });
    const snapshot = purchase.toSnapshot();
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          amount: snapshot.amount.amount,
          cardId: snapshot.cardId,
          currencyCode: snapshot.amount.currency.code,
          currencyMinorUnitScale: snapshot.amount.currency.minorUnitScale,
          description: snapshot.description,
          externalId: snapshot.externalId,
          occurredAt: snapshot.occurredAt.toISOString(),
        }),
      )
      .digest('hex');
    return this.purchases.register(
      purchase,
      command.idempotencyKey,
      requestFingerprint,
      FinancialAuditEvent.create({
        action: 'created',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: purchase.id,
        resourceType: 'card-purchase',
      }),
    );
  }
}
