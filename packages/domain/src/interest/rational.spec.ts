import { describe, expect, it } from 'vitest';

import { InvalidRationalError, Rational } from './rational.js';

describe('Rational', () => {
  it('reduces fractions and keeps the denominator positive', () => {
    const value = Rational.of(6n, -4n);

    expect(value.numerator).toBe(-3n);
    expect(value.denominator).toBe(2n);
  });

  it('parses decimal strings exactly', () => {
    expect(Rational.fromDecimal('1.25').toString()).toBe('5/4');
    expect(Rational.fromDecimal('-0.10').toString()).toBe('-1/10');
  });

  it('composes powers without intermediate rounding', () => {
    const factor = Rational.one.add(Rational.of(1n, 100n)).pow(2);

    expect(factor.toString()).toBe('10201/10000');
  });

  it.each([
    [Rational.of(5n, 2n), 3n],
    [Rational.of(-5n, 2n), -3n],
    [Rational.of(249n, 100n), 2n],
    [Rational.of(-249n, 100n), -2n],
    [Rational.of(7n, 1n), 7n],
  ])('rounds %s half up (away from zero) to %s', (value, expected) => {
    expect(value.roundHalfUp()).toBe(expected);
  });

  it('floors toward negative infinity', () => {
    expect(Rational.of(-5n, 2n).floor()).toBe(-3n);
    expect(Rational.of(5n, 2n).floor()).toBe(2n);
  });

  it('rejects zero denominators, division by zero and invalid exponents', () => {
    expect(() => Rational.of(1n, 0n)).toThrow(InvalidRationalError);
    expect(() => Rational.one.divide(Rational.zero)).toThrow(
      InvalidRationalError,
    );
    expect(() => Rational.one.pow(-1)).toThrow(InvalidRationalError);
    expect(() => Rational.fromDecimal('1e3')).toThrow(InvalidRationalError);
  });
});
