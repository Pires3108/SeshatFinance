import { describe, expect, it } from 'vitest';

import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import {
  AccountReserve,
  AccountReserveExceedsBalanceError,
  calculateAccountAvailability,
  InvalidAccountReserveError,
} from './account-reserve.js';

const brl = Currency.create('BRL', 2);
const usd = Currency.create('USD', 2);
const money = (amount: string): Money => Money.fromDecimal(amount, brl);
const created = new Date('2026-11-26T12:00:00.000Z');
const later = new Date('2026-11-27T12:00:00.000Z');

function declare(amount = '30.00', balance = '100.00'): AccountReserve {
  return AccountReserve.declare({
    accountId: 'ACCOUNT-1',
    amount: money(amount),
    at: created,
    balance: money(balance),
    ownerId: 'owner-id',
  });
}

describe('AccountReserve', () => {
  it('splits 100 into 70 available and 30 reserved without new money', () => {
    const reserve = declare();
    const view = calculateAccountAvailability(money('100.00'), reserve.amount);

    expect(reserve.accountId).toBe('account-1');
    expect(reserve.version).toBe(1);
    expect(view.book.toDecimal()).toBe('100.00');
    expect(view.reserved.toDecimal()).toBe('30.00');
    expect(view.available.toDecimal()).toBe('70.00');
    expect(view.available.add(view.reserved).equals(view.book)).toBe(true);
    expect(view.reserveAboveBalance).toBe(false);
  });

  it('raises available by the removed reserve and keeps the book balance', () => {
    const reserve = declare();
    reserve.change(money('0.00'), money('100.00'), later);
    const view = calculateAccountAvailability(money('100.00'), reserve.amount);

    expect(reserve.version).toBe(2);
    expect(view.available.toDecimal()).toBe('100.00');
    expect(view.book.toDecimal()).toBe('100.00');
  });

  it('refuses a reserve above the eligible balance', () => {
    expect(() => declare('120.00')).toThrow(AccountReserveExceedsBalanceError);
    const reserve = declare();
    expect(() => {
      reserve.change(money('120.00'), money('100.00'), later);
    }).toThrow(AccountReserveExceedsBalanceError);
    expect(reserve.amount.toDecimal()).toBe('30.00');
    expect(reserve.version).toBe(1);
  });

  it('keeps the reserve and warns when the balance falls below it', () => {
    const reserve = declare();
    const view = calculateAccountAvailability(money('10.00'), reserve.amount);

    expect(view.available.toDecimal()).toBe('-20.00');
    expect(view.reserveAboveBalance).toBe(true);
    reserve.change(money('20.00'), money('10.00'), later);
    expect(reserve.amount.toDecimal()).toBe('20.00');
  });

  it('treats a missing reserve as zero', () => {
    const view = calculateAccountAvailability(money('-5.00'), null);

    expect(view.reserved.toDecimal()).toBe('0.00');
    expect(view.available.toDecimal()).toBe('-5.00');
    expect(view.reserveAboveBalance).toBe(false);
  });

  it.each([
    [
      'another currency',
      () => {
        declare().change(
          Money.fromDecimal('1.00', usd),
          money('100.00'),
          later,
        );
      },
    ],
    ['a negative amount', () => declare('-1.00')],
    [
      'the same value',
      () => {
        declare().change(money('30.00'), money('100.00'), later);
      },
    ],
    [
      'a change back in time',
      () => {
        declare().change(
          money('10.00'),
          money('100.00'),
          new Date('2026-11-25T00:00:00.000Z'),
        );
      },
    ],
  ])('rejects %s', (_label, act) => {
    expect(act).toThrow(InvalidAccountReserveError);
  });

  it('restores its snapshot', () => {
    const reserve = declare();
    expect(AccountReserve.restore(reserve.toSnapshot()).toSnapshot()).toEqual(
      reserve.toSnapshot(),
    );
  });
});
