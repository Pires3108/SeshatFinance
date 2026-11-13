import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { CardPurchase, InvalidCardPurchaseError } from './card-purchase.js';

const brl = Currency.create('BRL', 2);
const base = {
  amount: Money.fromDecimal('120.35', brl),
  cardId: 'card-id',
  createdAt: new Date('2026-10-20T15:00:00.000Z'),
  cycleClosesOn: CivilDate.parse('2026-10-28'),
  description: ' Mercado ',
  id: 'purchase-id',
  occurredAt: new Date('2026-10-20T14:00:00.000Z'),
  ownerId: 'owner-id',
} as const;

describe('CardPurchase', () => {
  it('records the exact amount, cycle and trimmed texts', () => {
    expect(
      CardPurchase.create({ ...base, externalId: '  ' }).toSnapshot(),
    ).toMatchObject({
      amount: { amount: '120.35', currency: { code: 'BRL' } },
      categoryId: null,
      cycleClosesOn: '2026-10-28',
      description: 'Mercado',
      externalId: null,
    });
  });

  it('restores from its snapshot', () => {
    const purchase = CardPurchase.create({ ...base, categoryId: 'cat-id' });
    expect(CardPurchase.restore(purchase.toSnapshot()).toSnapshot()).toEqual(
      purchase.toSnapshot(),
    );
  });

  it.each([
    ['zero amount', { amount: Money.fromDecimal('0', brl) }],
    ['negative amount', { amount: Money.fromDecimal('-1', brl) }],
    ['empty description', { description: '  ' }],
    ['long description', { description: 'x'.repeat(501) }],
    ['long external id', { externalId: 'x'.repeat(256) }],
    ['invalid instant', { occurredAt: new Date('invalid') }],
  ])('rejects %s', (_label, change) => {
    expect(() => CardPurchase.create({ ...base, ...change })).toThrow(
      InvalidCardPurchaseError,
    );
  });
});
