import { describe, expect, it } from 'vitest';

import {
  InvalidManualExchangeQuoteError,
  ManualExchangeQuote,
  type ManualExchangeQuoteSnapshot,
} from './manual-exchange-quote.js';

const base: ManualExchangeQuoteSnapshot = {
  authorId: 'actor-id',
  effectiveAt: new Date('2026-09-30T12:00:00.000Z'),
  id: 'quote-id',
  ownerId: 'owner-id',
  rate: '5.000000000000000001',
  recordedAt: new Date('2026-09-30T13:00:00.000Z'),
  source: 'User-declared bank quote',
  sourceCurrencyCode: 'USD',
  targetCurrencyCode: 'BRL',
  version: 1,
};

describe('ManualExchangeQuote', () => {
  it('preserves the exact textual rate, currencies and declared provenance', () => {
    expect(ManualExchangeQuote.create(base).toSnapshot()).toEqual(base);
  });

  it('creates an independent corrected version without rewriting the original', () => {
    const original = ManualExchangeQuote.create(base);
    const corrected = original.correct({
      authorId: 'correction-author',
      effectiveAt: new Date('2026-10-01T12:00:00.000Z'),
      rate: '5.1',
      recordedAt: new Date('2026-10-01T13:00:00.000Z'),
      source: 'Manual correction',
    });
    expect(original.toSnapshot()).toEqual(base);
    expect(corrected.toSnapshot()).toMatchObject({
      id: base.id,
      ownerId: base.ownerId,
      rate: '5.1',
      sourceCurrencyCode: 'USD',
      targetCurrencyCode: 'BRL',
      version: 2,
    });
  });

  it.each([
    { rate: '0' },
    { rate: '0.000' },
    { rate: '-1' },
    { rate: '1e3' },
    { rate: '1,5' },
    { sourceCurrencyCode: 'JPY' },
    { targetCurrencyCode: 'USD' },
    { source: '' },
  ])('rejects invalid quote %#', (change) => {
    expect(() =>
      ManualExchangeQuote.create({
        ...base,
        ...change,
      } as ManualExchangeQuoteSnapshot),
    ).toThrow(InvalidManualExchangeQuoteError);
  });
});
