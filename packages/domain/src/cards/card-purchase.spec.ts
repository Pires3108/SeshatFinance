import { describe, expect, it } from 'vitest';

import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { CardPurchase, InvalidCardPurchaseError } from './card-purchase.js';

const currency = Currency.create('BRL', 2);
const properties = {
  amount: Money.fromDecimal('10.50', currency),
  cardId: 'card-id',
  createdAt: new Date('2026-10-05T12:00:00Z'),
  description: 'Compra de mercado',
  id: 'purchase-id',
  occurredAt: new Date('2026-10-04T12:00:00Z'),
  ownerId: 'owner-id',
} as const;

describe('CardPurchase', () => {
  it('records one positive obligation in explicit currency', () => {
    expect(CardPurchase.create(properties).toSnapshot()).toMatchObject({
      amount: { amount: '10.50', currency: { code: 'BRL', minorUnitScale: 2 } },
      cardId: 'card-id',
      ownerId: 'owner-id',
    });
  });

  it.each(['0', '-0.01'])('rejects nonpositive amount %s', (amount) => {
    expect(() =>
      CardPurchase.create({
        ...properties,
        amount: Money.fromDecimal(amount, currency),
      }),
    ).toThrow(InvalidCardPurchaseError);
  });
});
