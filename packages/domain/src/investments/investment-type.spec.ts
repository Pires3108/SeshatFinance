import { describe, expect, it } from 'vitest';

import {
  InvalidInvestmentTypeError,
  InvestmentType,
  investmentTypeKeys,
} from './investment-type.js';

describe('InvestmentType', () => {
  it('contains exactly the eleven types required by RF-051', () => {
    expect(investmentTypeKeys).toEqual([
      'treasury-direct',
      'cdb',
      'lci',
      'lca',
      'savings',
      'stock',
      'fii',
      'etf',
      'cryptocurrency',
      'investment-fund',
      'private-pension',
    ]);
    expect(new Set(investmentTypeKeys).size).toBe(investmentTypeKeys.length);
  });

  it.each(investmentTypeKeys)('round-trips %s as a stable key', (key) => {
    const type = InvestmentType.create(key);
    expect(InvestmentType.restore(type.toSnapshot()).equals(type)).toBe(true);
  });

  it.each(['', 'unknown', 'Treasury Direct', 'cdb '])(
    'rejects unsupported key %s',
    (key) => {
      expect(() => InvestmentType.create(key)).toThrow(
        InvalidInvestmentTypeError,
      );
    },
  );
});
