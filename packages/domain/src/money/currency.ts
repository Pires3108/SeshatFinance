const currencyCodePattern = /^[A-Z]{3}$/u;
const maximumMinorUnitScale = 18;

export type CurrencySnapshot = Readonly<{
  code: string;
  minorUnitScale: number;
}>;

export class InvalidCurrencyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCurrencyError';
  }
}

export class Currency {
  private constructor(
    public readonly code: string,
    public readonly minorUnitScale: number,
  ) {}

  public static create(code: string, minorUnitScale: number): Currency {
    if (!currencyCodePattern.test(code)) {
      throw new InvalidCurrencyError(
        'Currency code must contain exactly three uppercase ASCII letters.',
      );
    }
    if (
      !Number.isInteger(minorUnitScale) ||
      minorUnitScale < 0 ||
      minorUnitScale > maximumMinorUnitScale
    ) {
      throw new InvalidCurrencyError(
        `Currency minor unit scale must be an integer from 0 to ${String(maximumMinorUnitScale)}.`,
      );
    }
    return new Currency(code, minorUnitScale);
  }

  public static restore(snapshot: CurrencySnapshot): Currency {
    return Currency.create(snapshot.code, snapshot.minorUnitScale);
  }

  public equals(other: Currency): boolean {
    return (
      this.code === other.code && this.minorUnitScale === other.minorUnitScale
    );
  }

  public toSnapshot(): CurrencySnapshot {
    return { code: this.code, minorUnitScale: this.minorUnitScale };
  }
}
