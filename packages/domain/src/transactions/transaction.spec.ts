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
    observations: '  Confirmada fora da aplicação  ',
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

  it('updates the balance effect as one versioned edit', () => {
    const value = transaction('income');

    value.updateDetails(
      {
        amount: Money.fromDecimal('30.50', currency),
        description: 'Despesa corrigida',
        kind: 'expense',
        observations: '  Conferida no extrato  ',
        occurredAt: new Date('2026-09-19T11:00:00.000Z'),
      },
      new Date('2026-09-20T13:00:00.000Z'),
    );

    expect(value.balanceEffect().toDecimal()).toBe('-30.50');
    expect(value.toSnapshot()).toMatchObject({
      description: 'Despesa corrigida',
      kind: 'expense',
      observations: 'Conferida no extrato',
      version: 2,
    });
  });

  it('restores an archived transaction to active after trash recovery', () => {
    const value = transaction('income');
    value.archive(new Date('2026-09-20T13:00:00.000Z'));
    value.moveToTrash(new Date('2026-09-20T14:00:00.000Z'));
    value.restoreFromTrash(new Date('2026-09-20T15:00:00.000Z'));

    expect(value.lifecycle).toBe('archived');
    value.unarchive(new Date('2026-09-20T16:00:00.000Z'));
    expect(value.lifecycle).toBe('active');
  });
});
