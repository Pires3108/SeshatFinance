import { CivilDate } from '../calendar/civil-date.js';
import { Money, type MoneySnapshot } from '../money/money.js';

export type CardPurchaseSnapshot = Readonly<{
  amount: MoneySnapshot;
  cardId: string;
  categoryId: string | null;
  createdAt: Date;
  /** Closing date (ISO civil) of the single cycle the purchase belongs to. */
  cycleClosesOn: string;
  description: string;
  externalId: string | null;
  id: string;
  occurredAt: Date;
  ownerId: string;
  /** True when its own cycle was already closed and it joined the next open invoice. */
  postedAfterClose: boolean;
}>;

export type CreateCardPurchaseProperties = Readonly<{
  amount: Money;
  cardId: string;
  categoryId?: string | null | undefined;
  createdAt: Date;
  cycleClosesOn: CivilDate;
  description: string;
  externalId?: string | null | undefined;
  id: string;
  occurredAt: Date;
  ownerId: string;
  postedAfterClose?: boolean | undefined;
}>;

export class InvalidCardPurchaseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCardPurchaseError';
  }
}

/**
 * A purchase already made with the card, recorded once as an expense and as
 * the same amount of card obligation (INV-014). It never touches the paying
 * account; only a declared settlement does (US-041).
 */
export class CardPurchase {
  private constructor(private readonly state: CardPurchaseSnapshot) {}

  public static create(properties: CreateCardPurchaseProperties): CardPurchase {
    assertText(properties.id, 'Card purchase id');
    assertText(properties.ownerId, 'Card purchase owner id');
    assertText(properties.cardId, 'Card id');
    const description = properties.description.trim();
    if (description.length === 0 || description.length > 500) {
      throw new InvalidCardPurchaseError(
        'Card purchase description must have 1 to 500 characters.',
      );
    }
    const externalId = properties.externalId?.trim() ?? '';
    if (externalId.length > 255) {
      throw new InvalidCardPurchaseError(
        'External id must be at most 255 characters.',
      );
    }
    const categoryId = properties.categoryId ?? null;
    if (categoryId !== null) assertText(categoryId, 'Category id');
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
      categoryId,
      createdAt: new Date(properties.createdAt),
      cycleClosesOn: properties.cycleClosesOn.toString(),
      description,
      externalId: externalId === '' ? null : externalId,
      id: properties.id,
      occurredAt: new Date(properties.occurredAt),
      ownerId: properties.ownerId,
      postedAfterClose: properties.postedAfterClose ?? false,
    });
  }

  public static restore(snapshot: CardPurchaseSnapshot): CardPurchase {
    return CardPurchase.create({
      ...snapshot,
      amount: Money.restore(snapshot.amount),
      cycleClosesOn: CivilDate.parse(snapshot.cycleClosesOn),
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

  public get cycleClosesOn(): CivilDate {
    return CivilDate.parse(this.state.cycleClosesOn);
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
