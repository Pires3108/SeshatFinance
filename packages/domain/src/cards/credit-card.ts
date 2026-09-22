import { Money, type MoneySnapshot } from '../money/money.js';

export type CreditCardSnapshot = Readonly<{
  brand: string;
  closingDay: number;
  createdAt: Date;
  dueDay: number;
  id: string;
  limit: MoneySnapshot;
  name: string;
  ownerId: string;
  paymentAccountId: string;
}>;

export type CreateCreditCardProperties = Readonly<{
  brand: string;
  closingDay: number;
  createdAt: Date;
  dueDay: number;
  id: string;
  limit: Money;
  name: string;
  ownerId: string;
  paymentAccountId: string;
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
      closingDay: properties.closingDay,
      createdAt: new Date(properties.createdAt),
      dueDay: properties.dueDay,
      id: properties.id,
      limit: properties.limit.toSnapshot(),
      name: properties.name.trim(),
      ownerId: properties.ownerId,
      paymentAccountId: properties.paymentAccountId,
    });
  }

  public static restore(snapshot: CreditCardSnapshot): CreditCard {
    return CreditCard.create({
      ...snapshot,
      limit: Money.restore(snapshot.limit),
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
