import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { describe, expect, it } from 'vitest';
import {
  BalanceAdjustment,
  InvalidBalanceAdjustmentError,
} from './balance-adjustment.js';

const currency = Currency.create('BRL', 2);

function create(previous: string, reported: string): BalanceAdjustment {
  return BalanceAdjustment.create({
    accountId: 'account-id',
    createdAt: new Date('2026-09-21T12:00:00.000Z'),
    id: 'adjustment-id',
    justification: 'Saldo conferido no extrato',
    occurredAt: new Date('2026-09-21T11:00:00.000Z'),
    ownerId: 'owner-id',
    previousBalance: Money.fromDecimal(previous, currency),
    reportedBalance: Money.fromDecimal(reported, currency),
    transactionId: 'transaction-id',
  });
}

describe('BalanceAdjustment', () => {
  it('creates a positive entry that closes the reported difference', () => {
    const snapshot = create('90.00', '100.25').toSnapshot();

    expect(snapshot).toMatchObject({
      difference: { amount: '10.25' },
      justification: 'Saldo conferido no extrato',
      previousBalance: { amount: '90.00' },
      reportedBalance: { amount: '100.25' },
      transaction: { amount: { amount: '10.25' }, kind: 'income' },
    });
  });

  it('creates a negative entry using an absolute transaction amount', () => {
    const snapshot = create('100.25', '90.00').toSnapshot();

    expect(snapshot.difference.amount).toBe('-10.25');
    expect(snapshot.transaction).toMatchObject({
      amount: { amount: '10.25' },
      kind: 'expense',
    });
  });

  it('rejects an empty justification or zero difference', () => {
    expect(() => create('100.00', '100.00')).toThrow(
      InvalidBalanceAdjustmentError,
    );
    expect(() =>
      BalanceAdjustment.create({
        accountId: 'account-id',
        createdAt: new Date('2026-09-21T12:00:00.000Z'),
        id: 'adjustment-id',
        justification: ' ',
        occurredAt: new Date('2026-09-21T11:00:00.000Z'),
        ownerId: 'owner-id',
        previousBalance: Money.fromDecimal('90.00', currency),
        reportedBalance: Money.fromDecimal('100.00', currency),
        transactionId: 'transaction-id',
      }),
    ).toThrow(InvalidBalanceAdjustmentError);
  });
});
