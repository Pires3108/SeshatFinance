import { Currency, type CurrencySnapshot } from './currency.js';

const decimalAmountPattern = /^(-?)(\d+)(?:\.(\d+))?$/u;

export type MoneyComparison = -1 | 0 | 1;

export type MoneySnapshot = Readonly<{
  amount: string;
  currency: CurrencySnapshot;
}>;

export class InvalidMoneyAmountError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyAmountError';
  }
}

export class CurrencyMismatchError extends Error {
  public constructor(left: Currency, right: Currency) {
    super(
      `Money operation requires matching currencies (${left.code}/${String(left.minorUnitScale)} and ${right.code}/${String(right.minorUnitScale)}).`,
    );
    this.name = 'CurrencyMismatchError';
  }
}

export class Money {
  private constructor(
    private readonly minorUnits: bigint,
    public readonly currency: Currency,
  ) {}

  public static fromDecimal(amount: string, currency: Currency): Money {
    return new Money(
      parseMinorUnits(amount, currency.minorUnitScale),
      currency,
    );
  }

  public static fromMinorUnits(minorUnits: bigint, currency: Currency): Money {
    return new Money(minorUnits, currency);
  }

  public static restore(snapshot: MoneySnapshot): Money {
    return Money.fromDecimal(
      snapshot.amount,
      Currency.restore(snapshot.currency),
    );
  }

  public add(other: Money): Money {
    this.assertMatchingCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  public subtract(other: Money): Money {
    this.assertMatchingCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  public negate(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  public compare(other: Money): MoneyComparison {
    this.assertMatchingCurrency(other);
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  public equals(other: Money): boolean {
    return (
      this.currency.equals(other.currency) &&
      this.minorUnits === other.minorUnits
    );
  }

  public isZero(): boolean {
    return this.minorUnits === 0n;
  }

  public toDecimal(): string {
    return formatMinorUnits(this.minorUnits, this.currency.minorUnitScale);
  }

  public toMinorUnits(): bigint {
    return this.minorUnits;
  }

  public toSnapshot(): MoneySnapshot {
    return { amount: this.toDecimal(), currency: this.currency.toSnapshot() };
  }

  private assertMatchingCurrency(other: Money): void {
    if (!this.currency.equals(other.currency)) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

function parseMinorUnits(amount: string, scale: number): bigint {
  const match = decimalAmountPattern.exec(amount);
  if (match === null) {
    throw new InvalidMoneyAmountError(
      'Money amount must be a plain decimal string.',
    );
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const integerPart = match[2] ?? '';
  const fractionalPart = match[3] ?? '';
  if (fractionalPart.length > scale) {
    throw new InvalidMoneyAmountError(
      'Money amount exceeds the currency minor unit scale.',
    );
  }
  const paddedFraction = fractionalPart.padEnd(scale, '0');
  const digits = `${integerPart}${paddedFraction}`.replace(/^0+(?=\d)/u, '');
  return sign * BigInt(digits);
}

function formatMinorUnits(minorUnits: bigint, scale: number): string {
  const sign = minorUnits < 0n ? '-' : '';
  const absoluteDigits = (
    minorUnits < 0n ? -minorUnits : minorUnits
  ).toString();
  if (scale === 0) return `${sign}${absoluteDigits}`;
  const padded = absoluteDigits.padStart(scale + 1, '0');
  const integerPart = padded.slice(0, -scale);
  const fractionalPart = padded.slice(-scale);
  return `${sign}${integerPart}.${fractionalPart}`;
}
