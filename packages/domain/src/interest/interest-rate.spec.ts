import { describe, expect, it } from 'vitest';

import { InterestRate, InvalidInterestRateError } from './interest-rate.js';

describe('InterestRate', () => {
  it('stores a declared monthly percentage as an exact fraction', () => {
    const rate = InterestRate.create({
      method: 'compound',
      percentPerPeriod: '1.500000',
      periodicity: 'monthly',
    });

    expect(rate.toFraction().toString()).toBe('3/200');
    expect(rate.toSnapshot()).toEqual({
      method: 'compound',
      percentPerPeriod: '1.5',
      periodicity: 'monthly',
    });
  });

  it('accepts zero and one hundred percent', () => {
    const base = { method: 'simple', periodicity: 'monthly' } as const;

    expect(
      InterestRate.create({ ...base, percentPerPeriod: '0' }).isZero(),
    ).toBe(true);
    expect(
      InterestRate.create({ ...base, percentPerPeriod: '100' })
        .toFraction()
        .toString(),
    ).toBe('1');
  });

  it.each([
    [
      'missing method',
      { method: '', percentPerPeriod: '1', periodicity: 'monthly' },
    ],
    [
      'unknown method',
      { method: 'price', percentPerPeriod: '1', periodicity: 'monthly' },
    ],
    [
      'missing periodicity',
      { method: 'simple', percentPerPeriod: '1', periodicity: '' },
    ],
    [
      'annual periodicity',
      { method: 'simple', percentPerPeriod: '1', periodicity: 'yearly' },
    ],
    [
      'negative rate',
      { method: 'simple', percentPerPeriod: '-1', periodicity: 'monthly' },
    ],
    [
      'more than six places',
      {
        method: 'simple',
        percentPerPeriod: '1.0000001',
        periodicity: 'monthly',
      },
    ],
    [
      'above one hundred',
      {
        method: 'simple',
        percentPerPeriod: '100.000001',
        periodicity: 'monthly',
      },
    ],
    [
      'exponent notation',
      { method: 'simple', percentPerPeriod: '1e2', periodicity: 'monthly' },
    ],
  ])('rejects %s', (_label, input) => {
    expect(() => InterestRate.create(input)).toThrow(InvalidInterestRateError);
  });
});
