import { Money, type MoneySnapshot } from '../money/money.js';
import {
  CARD_CLOSING_BOUNDARIES,
  CardCycleSchedule,
  DEFAULT_CARD_CLOSING_BOUNDARY,
  type CardClosingBoundary,
} from './card-cycle-schedule.js';

export type CreditCardSnapshot = Readonly<{
  brand: string;
  closingBoundary: CardClosingBoundary;
  closingDay: number;
  createdAt: Date;
  dueDay: number;
  id: string;
  limit: MoneySnapshot;
  name: string;
  ownerId: string;
  paymentAccountId: string;
  version: number;
}>;

export type CreateCreditCardProperties = Readonly<{
  brand: string;
  closingBoundary?: CardClosingBoundary;
  closingDay: number;
  createdAt: Date;
  dueDay: number;
  id: string;
  limit: Money;
  name: string;
  ownerId: string;
  paymentAccountId: string;
  version?: number;
}>;

/** Organizational settings the holder may change after registration. */
export type CreditCardChanges = Readonly<{
  brand: string;
  closingBoundary: CardClosingBoundary;
  closingDay: number;
  dueDay: number;
  limit: Money;
  name: string;
}>;

export class InvalidCreditCardError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCreditCardError';
  }
}

export class CreditCard {
  private constructor(private readonly state: CreditCardSnapshot) {}

  public static create(properties: CreateCreditCardProperties): CreditCard {
    assertRequiredText(properties.id, 'Credit card id');
    assertRequiredText(properties.ownerId, 'Credit card owner id');
    assertRequiredText(properties.paymentAccountId, 'Payment account id');
    assertRequiredText(properties.name, 'Credit card name');
    assertRequiredText(properties.brand, 'Credit card brand');
    assertCycleDay(properties.closingDay, 'Credit card closing day');
    assertCycleDay(properties.dueDay, 'Credit card due day');
    const closingBoundary =
      properties.closingBoundary ?? DEFAULT_CARD_CLOSING_BOUNDARY;
    if (!CARD_CLOSING_BOUNDARIES.includes(closingBoundary)) {
      throw new InvalidCreditCardError('Unknown credit card closing boundary.');
    }
    const version = properties.version ?? 1;
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new InvalidCreditCardError('Credit card version must be positive.');
    }
    if (Number.isNaN(properties.createdAt.getTime())) {
      throw new InvalidCreditCardError(
        'Credit card creation instant must be valid.',
      );
    }
    if (properties.limit.toMinorUnits() < 0n) {
      throw new InvalidCreditCardError('Credit card limit cannot be negative.');
    }

    return new CreditCard({
      brand: properties.brand.trim(),
      closingBoundary,
      closingDay: properties.closingDay,
      createdAt: new Date(properties.createdAt),
      dueDay: properties.dueDay,
      id: properties.id,
      limit: properties.limit.toSnapshot(),
      name: properties.name.trim(),
      ownerId: properties.ownerId,
      paymentAccountId: properties.paymentAccountId,
      version,
    });
  }

  public static restore(snapshot: CreditCardSnapshot): CreditCard {
    return CreditCard.create({
      ...snapshot,
      limit: Money.restore(snapshot.limit),
    });
  }

  /**
   * Returns the card with new organizational settings and the next version.
   * The limit keeps the card currency; it never blocks external purchases.
   */
  public update(changes: CreditCardChanges): CreditCard {
    if (!changes.limit.currency.equals(this.limit.currency)) {
      throw new InvalidCreditCardError(
        'Credit card limit must keep the card currency.',
      );
    }
    return CreditCard.create({
      ...changes,
      createdAt: this.state.createdAt,
      id: this.state.id,
      ownerId: this.state.ownerId,
      paymentAccountId: this.state.paymentAccountId,
      version: this.state.version + 1,
    });
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get paymentAccountId(): string {
    return this.state.paymentAccountId;
  }

  public get limit(): Money {
    return Money.restore(this.state.limit);
  }

  public get version(): number {
    return this.state.version;
  }

  public get cycleSchedule(): CardCycleSchedule {
    return CardCycleSchedule.create({
      closingBoundary: this.state.closingBoundary,
      closingDay: this.state.closingDay,
      dueDay: this.state.dueDay,
    });
  }

  public toSnapshot(): CreditCardSnapshot {
    return {
      ...this.state,
      createdAt: new Date(this.state.createdAt),
      limit: {
        amount: this.state.limit.amount,
        currency: { ...this.state.limit.currency },
      },
    };
  }
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidCreditCardError(`${label} is required.`);
  }
}

function assertCycleDay(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 31) {
    throw new InvalidCreditCardError(`${label} must be between 1 and 31.`);
  }
}
