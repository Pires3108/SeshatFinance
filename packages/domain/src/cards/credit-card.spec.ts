import { describe, expect, it } from 'vitest';

import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { CreditCard, InvalidCreditCardError } from './credit-card.js';

const base = {
  brand: 'Visa',
  closingDay: 28,
  createdAt: new Date('2026-09-22T18:00:00.000Z'),
  dueDay: 7,
  id: 'card-id',
  limit: Money.fromDecimal('3500.00', Currency.create('BRL', 2)),
  name: 'Cartão principal',
  ownerId: 'owner-id',
  paymentAccountId: 'account-id',
} as const;

describe('CreditCard', () => {
  it('stores an explicit limit and declared cycle days without materializing dates', () => {
    const card = CreditCard.create(base);

    expect(card.toSnapshot()).toMatchObject({
      brand: 'Visa',
      closingDay: 28,
      dueDay: 7,
      limit: {
        amount: '3500.00',
        currency: { code: 'BRL', minorUnitScale: 2 },
      },
      name: 'Cartão principal',
      paymentAccountId: 'account-id',
    });
  });

  it.each([0, 32, 1.5])('rejects invalid cycle day %s', (day) => {
    expect(() => CreditCard.create({ ...base, closingDay: day })).toThrow(
      InvalidCreditCardError,
    );
  });

  it('rejects a negative organizational limit', () => {
    expect(() =>
      CreditCard.create({
        ...base,
        limit: Money.fromDecimal('-0.01', Currency.create('BRL', 2)),
      }),
    ).toThrow(InvalidCreditCardError);
  });
});
