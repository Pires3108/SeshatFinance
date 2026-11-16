export class InvalidRationalError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidRationalError';
  }
}

const decimalPattern = /^(-?)(\d+)(?:\.(\d+))?$/u;

/** Exact fraction of bigints, always reduced with a positive denominator. */
export class Rational {
  public static readonly zero = new Rational(0n, 1n);
  public static readonly one = new Rational(1n, 1n);

  private constructor(
    public readonly numerator: bigint,
    public readonly denominator: bigint,
  ) {}

  public static of(numerator: bigint, denominator = 1n): Rational {
    if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
      throw new InvalidRationalError('Rational parts must be bigints.');
    }
    if (denominator === 0n) {
      throw new InvalidRationalError('Rational denominator must not be zero.');
    }
    const sign = denominator < 0n ? -1n : 1n;
    const divisor = greatestCommonDivisor(abs(numerator), abs(denominator));
    return new Rational(
      (sign * numerator) / divisor,
      (sign * denominator) / divisor,
    );
  }

  public static fromDecimal(value: string): Rational {
    const match = decimalPattern.exec(value);
    if (match === null) {
      throw new InvalidRationalError(
        'Rational must be a plain decimal string.',
      );
    }
    const fraction = match[3] ?? '';
    const digits = BigInt(`${match[2] ?? ''}${fraction}`);
    return Rational.of(
      match[1] === '-' ? -digits : digits,
      10n ** BigInt(fraction.length),
    );
  }

  public add(other: Rational): Rational {
    return Rational.of(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  public subtract(other: Rational): Rational {
    return this.add(other.negate());
  }

  public multiply(other: Rational): Rational {
    return Rational.of(
      this.numerator * other.numerator,
      this.denominator * other.denominator,
    );
  }

  public divide(other: Rational): Rational {
    if (other.numerator === 0n) {
      throw new InvalidRationalError('Cannot divide by zero.');
    }
    return Rational.of(
      this.numerator * other.denominator,
      this.denominator * other.numerator,
    );
  }

  public negate(): Rational {
    return new Rational(-this.numerator, this.denominator);
  }

  /** Raises to a non-negative integer power without intermediate rounding. */
  public pow(exponent: number): Rational {
    if (!Number.isSafeInteger(exponent) || exponent < 0) {
      throw new InvalidRationalError(
        'Exponent must be a non-negative integer.',
      );
    }
    const power = BigInt(exponent);
    return Rational.of(this.numerator ** power, this.denominator ** power);
  }

  public compare(other: Rational): -1 | 0 | 1 {
    const left = this.numerator * other.denominator;
    const right = other.numerator * this.denominator;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  public isZero(): boolean {
    return this.numerator === 0n;
  }

  /** Nearest integer; exact halves move away from zero (HALF_UP). */
  public roundHalfUp(): bigint {
    const magnitude = abs(this.numerator);
    const quotient = magnitude / this.denominator;
    const remainder = magnitude % this.denominator;
    const rounded =
      remainder * 2n >= this.denominator ? quotient + 1n : quotient;
    return this.numerator < 0n ? -rounded : rounded;
  }

  /** Largest integer not greater than this value. */
  public floor(): bigint {
    const quotient = this.numerator / this.denominator;
    return this.numerator < 0n && quotient * this.denominator !== this.numerator
      ? quotient - 1n
      : quotient;
  }

  public toString(): string {
    return this.denominator === 1n
      ? this.numerator.toString()
      : `${this.numerator.toString()}/${this.denominator.toString()}`;
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a === 0n ? 1n : a;
}
