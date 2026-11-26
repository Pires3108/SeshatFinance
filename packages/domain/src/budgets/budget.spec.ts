import { describe, expect, it } from 'vitest';

import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import {
  Budget,
  BudgetLifecycleError,
  calculateBudgetConsumption,
  calculateBudgetRealized,
  InvalidBudgetError,
  type BudgetEntry,
} from './budget.js';

const brl = Currency.create('BRL', 2);
const usd = Currency.create('USD', 2);
const money = (amount: string): Money => Money.fromDecimal(amount, brl);
const at = new Date('2026-11-26T12:00:00.000Z');
const later = new Date('2026-11-27T12:00:00.000Z');

function market(): Budget {
  return Budget.create({
    createdAt: at,
    dimension: { id: 'CAT-MERCADO', kind: 'category' },
    effectiveFrom: '2026-11',
    id: 'budget-1',
    limit: money('500.00'),
    name: ' Mercado ',
    ownerId: 'owner',
  });
}

function expense(
  id: string,
  amount: string,
  change: Partial<BudgetEntry> = {},
): BudgetEntry {
  return {
    accountId: 'account-1',
    amount: money(amount),
    categoryId: 'cat-mercado',
    costCenterId: null,
    id,
    kind: 'expense',
    notSpending: false,
    refundOfExpenseId: null,
    subcategoryId: null,
    ...change,
  };
}

describe('Budget (US-052)', () => {
  it('shows 120 realized and 380 remaining of a 500 monthly budget', () => {
    const budget = market();
    const realized = calculateBudgetRealized(budget, [expense('e1', '120.00')]);
    const consumption = calculateBudgetConsumption(
      budget.limitFor('2026-11') ?? money('0.00'),
      realized.realized,
    );

    expect(budget.name).toBe('Mercado');
    expect(consumption.realized.toDecimal()).toBe('120.00');
    expect(consumption.remaining.toDecimal()).toBe('380.00');
    expect(consumption.exceeded).toBe(false);
  });

  it('reports the excess as a warning when realized passes the limit', () => {
    const consumption = calculateBudgetConsumption(
      money('500.00'),
      money('620.00'),
    );

    expect(consumption).toMatchObject({ exceeded: true });
    expect(consumption.excess.toDecimal()).toBe('120.00');
    expect(consumption.remaining.toDecimal()).toBe('0.00');
  });

  it('counts only matching spending, nets refunds and never adds currencies', () => {
    const result = calculateBudgetRealized(market(), [
      expense('e1', '100.00'),
      expense('other', '50.00', { categoryId: 'cat-lazer' }),
      expense('sub', '25.00', {
        categoryId: 'cat-casa',
        subcategoryId: 'CAT-MERCADO',
      }),
      expense('transfer', '70.00', { notSpending: true }),
      expense('income', '30.00', { kind: 'income' }),
      expense('usd', '10.00', { amount: Money.fromDecimal('10.00', usd) }),
      expense('refund', '40.00', { kind: 'income', refundOfExpenseId: 'E1' }),
      expense('comp', '15.00', { refundOfExpenseId: 'e1' }),
      expense('foreign-refund', '5.00', {
        kind: 'income',
        refundOfExpenseId: 'other',
      }),
    ]);

    expect(result.realized.toDecimal()).toBe('100.00');
    expect(result.countedEntries).toBe(2);
    expect(result.otherCurrencyEntries).toBe(1);
  });

  it('applies a new limit from a month on and keeps earlier months', () => {
    const budget = market();
    budget.change(
      {
        currentMonth: '2026-11',
        effectiveFrom: '2027-01',
        limit: money('600.00'),
        name: 'Mercado',
      },
      later,
    );

    expect(budget.limitFor('2026-10')).toBeNull();
    expect(budget.limitFor('2026-12')?.toDecimal()).toBe('500.00');
    expect(budget.limitFor('2027-03')?.toDecimal()).toBe('600.00');
    expect(budget.version).toBe(2);
    expect(() => {
      budget.change(
        {
          currentMonth: '2026-11',
          effectiveFrom: '2026-10',
          limit: money('1.00'),
          name: 'Mercado',
        },
        later,
      );
    }).toThrow(InvalidBudgetError);
  });

  it('refuses a limit for a past month after the last version', () => {
    const budget = market();
    expect(() => {
      budget.change(
        {
          currentMonth: '2027-06',
          effectiveFrom: '2027-03',
          limit: money('900.00'),
          name: 'Mercado',
        },
        later,
      );
    }).toThrow(InvalidBudgetError);
    expect(budget.limitFor('2027-03')?.toDecimal()).toBe('500.00');
  });

  it('archives, refuses edits while archived and restores', () => {
    const budget = market();
    budget.archive(later);
    expect(() => {
      budget.change(
        {
          currentMonth: '2026-11',
          effectiveFrom: '2026-11',
          limit: money('1.00'),
          name: 'x',
        },
        later,
      );
    }).toThrow(BudgetLifecycleError);
    budget.unarchive(later);
    expect(budget.lifecycle).toBe('active');
    expect(Budget.restore(budget.toSnapshot()).toSnapshot()).toEqual(
      budget.toSnapshot(),
    );
  });

  it.each([
    ['zero limit', { limit: money('0.00') }],
    ['bad month', { effectiveFrom: '2026-13' }],
    ['blank name', { name: ' ' }],
    ['unknown dimension', { dimension: { id: 'x', kind: 'tag' as 'account' } }],
  ])('rejects %s', (_label, change) => {
    expect(() =>
      Budget.create({
        createdAt: at,
        dimension: { id: 'a', kind: 'account' },
        effectiveFrom: '2026-11',
        id: 'b',
        limit: money('1.00'),
        name: 'B',
        ownerId: 'o',
        ...change,
      }),
    ).toThrow(InvalidBudgetError);
  });
});
