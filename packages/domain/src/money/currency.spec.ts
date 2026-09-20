import { describe, expect, it } from 'vitest';

import { Currency, InvalidCurrencyError } from './currency.js';

describe('Currency', () => {
  it('requires a three-letter uppercase code and explicit scale', () => {
    expect(Currency.create('BRL', 2).toSnapshot()).toEqual({
      code: 'BRL',
      minorUnitScale: 2,
    });
    expect(() => Currency.create('brl', 2)).toThrow(InvalidCurrencyError);
    expect(() => Currency.create('BRL', -1)).toThrow(InvalidCurrencyError);
  });
});
