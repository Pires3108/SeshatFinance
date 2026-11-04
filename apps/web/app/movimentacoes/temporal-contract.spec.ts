import { describe, expect, it } from 'vitest';

import {
  formatMoney,
  isCivilDate,
  isTemporalView,
  shiftDate,
} from './temporal-contract';

describe('temporal view contract', () => {
  it('moves across short months and rejects impossible civil dates', () => {
    expect(shiftDate('2024-03-31', 'month', -1)).toBe('2024-02-29');
    expect(shiftDate('2024-03-31', 'day', 1)).toBe('2024-04-01');
    expect(isCivilDate('2024-02-30')).toBe(false);
  });

  it('keeps decimal money as text and validates separate currencies', () => {
    expect(formatMoney('12345678901234567890.12', 'BRL', 2)).toBe(
      '12.345.678.901.234.567.890,12 BRL',
    );
    expect(
      isTemporalView({
        period: 'day',
        selectedDate: '2024-03-31',
        timeZone: 'America/Sao_Paulo',
        from: '2024-03-31T03:00:00.000Z',
        to: '2024-04-01T03:00:00.000Z',
        days: [],
        totals: [
          {
            currencyCode: 'BRL',
            currencyMinorUnitScale: 2,
            income: '10.00',
            expense: '1.00',
          },
          {
            currencyCode: 'USD',
            currencyMinorUnitScale: 2,
            income: '5.00',
            expense: '0.00',
          },
        ],
      }),
    ).toBe(true);
  });
});
