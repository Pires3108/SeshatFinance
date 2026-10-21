import { describe, expect, it } from 'vitest';

import { formatBalance } from './account-presentation';

describe('account balance presentation', () => {
  it('keeps decimal precision and currency without converting money to JavaScript number', () => {
    expect(
      formatBalance({
        amount: '12345678901234567890.01',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
      }),
    ).toBe('12.345.678.901.234.567.890,01 BRL');
    expect(
      formatBalance({
        amount: '-0.50',
        currencyCode: 'USD',
        currencyMinorUnitScale: 2,
      }),
    ).toBe('-0,50 USD');
  });
});
