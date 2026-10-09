import { describe, expect, it } from 'vitest';

import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import {
  calculateRefundSummary,
  InvalidRefundLedgerError,
  type RefundLedgerEntry,
} from './refund-ledger.js';

const brl = Currency.create('BRL', 2);
const usd = Currency.create('USD', 2);
const money = (amount: string): Money => Money.fromDecimal(amount, brl);

function refund(
  id: string,
  amount: string,
  lifecycle: RefundLedgerEntry['lifecycle'] = 'active',
): RefundLedgerEntry {
  return {
    id,
    amount: money(amount),
    lifecycle,
    kind: 'refund',
    compensatesRefundId: null,
  };
}

function compensation(
  id: string,
  refundId: string,
  amount: string,
  lifecycle: RefundLedgerEntry['lifecycle'] = 'active',
): RefundLedgerEntry {
  return {
    id,
    amount: money(amount),
    lifecycle,
    kind: 'compensation',
    compensatesRefundId: refundId,
  };
}

describe('calculateRefundSummary', () => {
  it('calculates exact net expense across partial refunds and compensations', () => {
    const summary = calculateRefundSummary(money('100.00'), [
      refund('first', '25.15'),
      refund('second', '40.05', 'archived'),
      compensation('correction', 'second', '10.10'),
    ]);
    expect(summary.refunded.toDecimal()).toBe('55.10');
    expect(summary.net.toDecimal()).toBe('44.90');
  });

  it('excludes trashed entries without losing their links', () => {
    const summary = calculateRefundSummary(money('100.00'), [
      refund('first', '20.00', 'trashed'),
      refund('second', '50.00'),
      compensation('correction', 'second', '10.00', 'trashed'),
    ]);
    expect(summary.refunded.toDecimal()).toBe('50.00');
    expect(summary.net.toDecimal()).toBe('50.00');
  });

  it('rejects over-refund, over-compensation and mixed currencies', () => {
    expect(() =>
      calculateRefundSummary(money('100.00'), [refund('first', '100.01')]),
    ).toThrow(InvalidRefundLedgerError);
    expect(() =>
      calculateRefundSummary(money('100.00'), [
        refund('first', '10.00'),
        compensation('correction', 'first', '10.01'),
      ]),
    ).toThrow(InvalidRefundLedgerError);
    expect(() =>
      calculateRefundSummary(money('100.00'), [
        {
          id: 'foreign',
          amount: Money.fromDecimal('1.00', usd),
          lifecycle: 'active',
          kind: 'refund',
          compensatesRefundId: null,
        },
      ]),
    ).toThrow(InvalidRefundLedgerError);
  });

  it('rejects trashing a refund while its compensation still affects the ledger', () => {
    expect(() =>
      calculateRefundSummary(money('100.00'), [
        refund('first', '40.00', 'trashed'),
        compensation('correction', 'first', '10.00'),
      ]),
    ).toThrow(InvalidRefundLedgerError);
  });

  it('keeps archived entries in the net calculation', () => {
    const summary = calculateRefundSummary(money('100.00'), [
      refund('first', '70.00', 'archived'),
      compensation('correction', 'first', '20.00', 'archived'),
    ]);
    expect(summary.refunded.toDecimal()).toBe('50.00');
    expect(summary.net.toDecimal()).toBe('50.00');
  });
});
