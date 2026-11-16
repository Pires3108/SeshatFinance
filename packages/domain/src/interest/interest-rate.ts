import { Rational } from './rational.js';

export const interestMethods = ['simple', 'compound'] as const;
export type InterestMethod = (typeof interestMethods)[number];

/** ADR-042: only the schedule period (monthly) is accepted; no equivalence. */
export const interestPeriodicities = ['monthly'] as const;
export type InterestPeriodicity = (typeof interestPeriodicities)[number];

export type InterestRateSnapshot = Readonly<{
  method: InterestMethod;
  percentPerPeriod: string;
  periodicity: InterestPeriodicity;
}>;

export class InvalidInterestRateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidInterestRateError';
  }
}

const percentPattern = /^(\d{1,3})(?:\.(\d{1,6}))?$/u;
const hundred = Rational.of(100n);

/** Declared percentage per period, 0 to 100 with up to six decimal places. */
export class InterestRate {
  private constructor(
    public readonly method: InterestMethod,
    public readonly percentPerPeriod: string,
    public readonly periodicity: InterestPeriodicity,
    private readonly fraction: Rational,
  ) {}

  public static create(input: {
    method: string;
    percentPerPeriod: string;
    periodicity: string;
  }): InterestRate {
    if (!isMember(interestMethods, input.method)) {
      throw new InvalidInterestRateError(
        'Interest method must be simple or compound.',
      );
    }
    if (!isMember(interestPeriodicities, input.periodicity)) {
      throw new InvalidInterestRateError(
        'Interest periodicity must match the monthly schedule.',
      );
    }
    if (
      typeof input.percentPerPeriod !== 'string' ||
      !percentPattern.test(input.percentPerPeriod)
    ) {
      throw new InvalidInterestRateError(
        'Interest rate must be a decimal percentage with up to six decimal places.',
      );
    }
    const percent = Rational.fromDecimal(input.percentPerPeriod);
    if (percent.compare(hundred) > 0) {
      throw new InvalidInterestRateError(
        'Interest rate must not exceed 100 percent per period.',
      );
    }
    return new InterestRate(
      input.method,
      normalizePercent(input.percentPerPeriod),
      input.periodicity,
      percent.divide(hundred),
    );
  }

  public static restore(snapshot: InterestRateSnapshot): InterestRate {
    return InterestRate.create(snapshot);
  }

  /** Exact rate as a fraction of one (1% → 1/100). */
  public toFraction(): Rational {
    return this.fraction;
  }

  public isZero(): boolean {
    return this.fraction.isZero();
  }

  public toSnapshot(): InterestRateSnapshot {
    return {
      method: this.method,
      percentPerPeriod: this.percentPerPeriod,
      periodicity: this.periodicity,
    };
  }
}

function isMember<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === 'string' && (values as readonly string[]).includes(value)
  );
}

function normalizePercent(value: string): string {
  const [integer = '0', fraction = ''] = value.split('.');
  const trimmedInteger = integer.replace(/^0+(?=\d)/u, '');
  const trimmedFraction = fraction.replace(/0+$/u, '');
  return trimmedFraction === ''
    ? trimmedInteger
    : `${trimmedInteger}.${trimmedFraction}`;
}
