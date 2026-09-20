import { describe, expect, it } from 'vitest';

import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import {
  calculateAccountBalance,
  InvalidTransactionError,
  Transaction,
} from './transaction.js';

const currency = Currency.create('BRL', 2);

function transaction(kind: 'income' | 'expense'): Transaction {
  return Transaction.create({
    accountId: 'account-id',
    amount: Money.fromDecimal('25.10', currency),
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    description: 'Movimentação sintética',
    id: `${kind}-id`,
    kind,
    occurredAt: new Date('2026-09-20T11:00:00.000Z'),
    ownerId: 'owner-id',
  });
}

describe('Transaction', () => {
  it('requires a positive amount with explicit currency', () => {
    expect(() =>
      Transaction.create({
        accountId: 'account-id',
        amount: Money.fromDecimal('0', currency),
        createdAt: new Date('2026-09-20T12:00:00.000Z'),
        description: null,
        id: 'transaction-id',
        kind: 'income',
        occurredAt: new Date('2026-09-20T11:00:00.000Z'),
        ownerId: 'owner-id',
      }),
    ).toThrow(InvalidTransactionError);
  });

  it('adds income and subtracts expense from the exact account balance', () => {
    const balance = calculateAccountBalance(
      Money.fromDecimal('100.00', currency),
      [transaction('income'), transaction('expense')],
    );

    expect(balance.toDecimal()).toBe('100.00');
  });

  it('preserves archived effects and removes trashed effects exactly once', () => {
    const income = transaction('income');
    income.archive(new Date('2026-09-20T13:00:00.000Z'));
    const expense = transaction('expense');
    expense.moveToTrash(new Date('2026-09-20T13:00:00.000Z'));

    expect(
      calculateAccountBalance(Money.fromDecimal('100.00', currency), [
        income,
        expense,
      ]).toDecimal(),
    ).toBe('125.10');

    expense.restoreFromTrash(new Date('2026-09-20T14:00:00.000Z'));
    expect(
      calculateAccountBalance(Money.fromDecimal('100.00', currency), [
        income,
        expense,
      ]).toDecimal(),
    ).toBe('100.00');
  });

  it('rejects balance calculations across currencies', () => {
    const income = transaction('income');

    expect(() =>
      calculateAccountBalance(
        Money.fromDecimal('100.00', Currency.create('USD', 2)),
        [income],
      ),
    ).toThrow();
  });
});
