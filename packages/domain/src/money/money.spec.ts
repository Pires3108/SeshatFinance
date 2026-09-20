import { describe, expect, it } from 'vitest';

import { Currency } from './currency.js';
import {
  CurrencyMismatchError,
  InvalidMoneyAmountError,
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
});
