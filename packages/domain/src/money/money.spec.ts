import { describe, expect, it } from 'vitest';

import { Currency, InvalidCurrencyError } from './currency.js';
import {
  CurrencyMismatchError,
  InvalidMoneyAmountError,
  InvalidMoneySplitCountError,
  Money,
} from './money.js';

describe('Money', () => {
  const brl = Currency.create('BRL', 2);

  it('adds decimal values without binary floating-point errors', () => {
    const result = Money.fromDecimal('0.1', brl).add(
      Money.fromDecimal('0.2', brl),
    );

    expect(result.toDecimal()).toBe('0.30');
    expect(result.toMinorUnits()).toBe(30n);
  });

  it.each([
    ['JPY', 0, '42', 42n],
    ['BHD', 3, '42.125', 42_125n],
  ])(
    'supports explicit minor unit scales for %s',
    (code, scale, amount, minorUnits) => {
      const money = Money.fromDecimal(amount, Currency.create(code, scale));

      expect(money.toMinorUnits()).toBe(minorUnits);
      expect(money.toDecimal()).toBe(amount);
    },
  );

  it('rejects precision beyond the explicit currency scale', () => {
    expect(() => Money.fromDecimal('10.001', brl)).toThrow(
      InvalidMoneyAmountError,
    );
  });

  it('requires currency and a decimal text amount at runtime', () => {
    expect(() => Money.fromDecimal('1.00', undefined as never)).toThrow(
      InvalidCurrencyError,
    );
    expect(() => Money.fromMinorUnits(100n, undefined as never)).toThrow(
      InvalidCurrencyError,
    );
    expect(() => Money.fromDecimal(1 as never, brl)).toThrow(
      InvalidMoneyAmountError,
    );
    expect(() => Money.fromMinorUnits(100 as never, brl)).toThrow(
      InvalidMoneyAmountError,
    );
  });

  it('rejects arithmetic across different currencies', () => {
    const usd = Currency.create('USD', 2);

    expect(() =>
      Money.fromDecimal('10.00', brl).add(Money.fromDecimal('1.00', usd)),
    ).toThrow(CurrencyMismatchError);
  });

  it('round-trips a persistence-safe snapshot', () => {
    const original = Money.fromDecimal('-12345678901234567890.05', brl);

    expect(Money.restore(original.toSnapshot()).equals(original)).toBe(true);
  });

  it.each([
    ['1.00', 'BRL', 2, 3, ['0.33', '0.33', '0.34']],
    ['-1.00', 'BRL', 2, 3, ['-0.33', '-0.33', '-0.34']],
    ['2', 'JPY', 0, 3, ['0', '0', '2']],
    ['0.001', 'BHD', 3, 2, ['0.000', '0.001']],
    ['-0.01', 'BRL', 2, 3, ['0.00', '0.00', '-0.01']],
    ['0.00', 'BRL', 2, 3, ['0.00', '0.00', '0.00']],
  ])(
    'splits %s %s across %i scale into %i exact shares',
    (amount, code, scale, count, expected) => {
      const original = Money.fromDecimal(amount, Currency.create(code, scale));
      const shares = original.split(count);

      expect(shares.map((share) => share.toDecimal())).toEqual(expected);
      expect(
        shares.every((share) => share.currency.equals(original.currency)),
      ).toBe(true);
      expect(
        shares
          .reduce(
            (total, share) => total.add(share),
            Money.fromMinorUnits(0n, original.currency),
          )
          .equals(original),
      ).toBe(true);
    },
  );

  it('keeps a single share exact even beyond the safe integer range', () => {
    const original = Money.fromDecimal('9007199254740993.01', brl);
    expect(original.split(1)[0]?.equals(original)).toBe(true);
    expect(original.negate().split(1)[0]?.equals(original.negate())).toBe(true);
  });

  it('accepts the maximum technical split count without losing a minor unit', () => {
    const original = Money.fromDecimal('0.01', brl);
    const shares = original.split(10_000);

    expect(shares).toHaveLength(10_000);
    expect(shares.slice(0, -1).every((share) => share.isZero())).toBe(true);
    expect(shares.at(-1)?.toDecimal()).toBe('0.01');
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    10_001,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid split count %s', (count) => {
    expect(() => Money.fromDecimal('1.00', brl).split(count)).toThrow(
      InvalidMoneySplitCountError,
    );
  });
});
