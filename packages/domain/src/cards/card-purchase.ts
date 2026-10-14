import { Money, type MoneySnapshot } from '../money/money.js';

export type CardPurchaseSnapshot = Readonly<{
  amount: MoneySnapshot;
  cardId: string;
  createdAt: Date;
  description: string;
  externalId: string | null;
  id: string;
  occurredAt: Date;
  ownerId: string;
}>;

export type CreateCardPurchaseProperties = Readonly<{
  amount: Money;
  cardId: string;
  createdAt: Date;
  description: string;
  externalId?: string | null | undefined;
  id: string;
  occurredAt: Date;
  ownerId: string;
}>;

export class InvalidCardPurchaseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCardPurchaseError';
  }
}

export class CardPurchase {
  private constructor(private readonly state: CardPurchaseSnapshot) {}

  public static create(properties: CreateCardPurchaseProperties): CardPurchase {
    assertText(properties.id, 'Card purchase id');
    assertText(properties.ownerId, 'Card purchase owner id');
    assertText(properties.cardId, 'Card id');
    assertText(properties.description, 'Card purchase description');
    if (
      properties.externalId !== undefined &&
      properties.externalId !== null &&
      properties.externalId.trim().length > 255
    ) {
      throw new InvalidCardPurchaseError(
        'External id must be at most 255 characters.',
      );
    }
    assertInstant(properties.createdAt, 'Card purchase creation instant');
    assertInstant(properties.occurredAt, 'Card purchase occurrence instant');
    if (properties.amount.toMinorUnits() <= 0n) {
      throw new InvalidCardPurchaseError(
        'Card purchase amount must be positive.',
      );
    }
    return new CardPurchase({
      amount: properties.amount.toSnapshot(),
      cardId: properties.cardId,
      createdAt: new Date(properties.createdAt),
      description: properties.description.trim(),
      externalId:
        properties.externalId?.trim() === ''
          ? null
          : (properties.externalId?.trim() ?? null),
      id: properties.id,
      occurredAt: new Date(properties.occurredAt),
      ownerId: properties.ownerId,
    });
  }

  public static restore(snapshot: CardPurchaseSnapshot): CardPurchase {
    return CardPurchase.create({
      ...snapshot,
      amount: Money.restore(snapshot.amount),
    });
  }

  public get id(): string {
    return this.state.id;
  }
  public get ownerId(): string {
    return this.state.ownerId;
  }
  public get cardId(): string {
    return this.state.cardId;
  }
  public get amount(): Money {
    return Money.restore(this.state.amount);
  }

  public toSnapshot(): CardPurchaseSnapshot {
    return {
      ...this.state,
      amount: {
        amount: this.state.amount.amount,
        currency: { ...this.state.amount.currency },
      },
      createdAt: new Date(this.state.createdAt),
      occurredAt: new Date(this.state.occurredAt),
    };
  }
}

function assertText(value: string, label: string): void {
  if (value.trim().length === 0)
    throw new InvalidCardPurchaseError(`${label} is required.`);
}

function assertInstant(value: Date, label: string): void {
  if (Number.isNaN(value.getTime()))
    throw new InvalidCardPurchaseError(`${label} must be valid.`);
}
