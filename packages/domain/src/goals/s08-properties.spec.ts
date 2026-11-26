import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Budget, calculateBudgetConsumption } from '../budgets/budget.js';
import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import {
  AccountReserveExceedsBalanceError,
  AccountReserve,
  calculateAccountAvailability,
} from '../reserves/account-reserve.js';
import { Goal } from './goal.js';
import {
  ContributionDistribution,
  ContributionExceedsSourceError,
} from './goal-contribution.js';
import { calculateGoalProgress } from './goal-progress.js';

/**
 * Sprint 8 properties (US-053): INV-012/013 (a reserve never creates or
 * removes money), INV-025 (lines never exceed their entry), INV-026 (goals
 * never change balances) and INV-047 (conversion is presentation only).
 */
const currencies = [
  Currency.create('BRL', 2),
  Currency.create('USD', 2),
  Currency.create('JPY', 0),
] as const;
const at = new Date('2026-11-26T12:00:00.000Z');
const minor = fc.bigInt({ max: 10n ** 12n, min: 0n });
const currency = fc.constantFrom(...currencies);

describe('S08 invariants as properties', () => {
  it('INV-012/013: book = available + reserve, and the book never changes', () => {
    fc.assert(
      fc.property(currency, minor, minor, (unit, book, reserve) => {
        const balance = Money.fromMinorUnits(book, unit);
        const amount = Money.fromMinorUnits(reserve, unit);
        let declared: AccountReserve;
        try {
          declared = AccountReserve.declare({
            accountId: 'a',
            amount,
            at,
            balance,
            ownerId: 'o',
          });
        } catch (error) {
          expect(error).toBeInstanceOf(AccountReserveExceedsBalanceError);
          expect(reserve > book).toBe(true);
          return;
        }
        const view = calculateAccountAvailability(balance, declared.amount);
        expect(view.book.equals(balance)).toBe(true);
        expect(view.available.add(view.reserved).equals(balance)).toBe(true);
        expect(view.reserveAboveBalance).toBe(false);
      }),
    );
  });

  it('INV-013: a later balance drop keeps the reserve and flags it', () => {
    fc.assert(
      fc.property(minor, minor, (reserve, drop) => {
        const unit = currencies[0];
        const reserved = Money.fromMinorUnits(reserve + 1n, unit);
        const balance = Money.fromMinorUnits(reserve - drop, unit);
        const view = calculateAccountAvailability(balance, reserved);
        expect(view.reserved.equals(reserved)).toBe(true);
        expect(view.available.add(view.reserved).equals(balance)).toBe(true);
        expect(view.reserveAboveBalance).toBe(true);
      }),
    );
  });

  it('INV-025: a distribution is accepted only when its lines fit the entry', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ max: 10n ** 9n, min: 1n }),
        fc.array(fc.bigInt({ max: 10n ** 9n, min: 1n }), {
          maxLength: 20,
          minLength: 0,
        }),
        (source, amounts) => {
          const unit = currencies[0];
          const total = amounts.reduce((sum, value) => sum + value, 0n);
          const create = (): ContributionDistribution =>
            ContributionDistribution.create({
              at,
              authorId: 'o',
              lines: amounts.map((value, index) => ({
                amount: Money.fromMinorUnits(value, unit),
                goalId: `goal-${String(index)}`,
              })),
              ownerId: 'o',
              source: Money.fromMinorUnits(source, unit),
              sourceTransactionId: 'entry',
            });
          if (total > source) {
            expect(create).toThrow(ContributionExceedsSourceError);
            return;
          }
          const allocated = create().allocated?.toMinorUnits() ?? 0n;
          expect(allocated).toBe(total);
          expect(allocated <= source).toBe(true);
        },
      ),
    );
  });

  it('INV-047: a quote changes the shown progress only, never the original value', () => {
    const goal = Goal.create({
      createdAt: at,
      deadline: null,
      id: 'goal',
      initialAmount: null,
      links: [{ accountId: 'usd', share: { kind: 'full' } }],
      mode: 'linked',
      name: 'Meta',
      ownerId: 'o',
      target: Money.fromDecimal('1000.00', currencies[0]),
    });
    fc.assert(
      fc.property(
        fc.bigInt({ max: 10n ** 9n, min: 0n }),
        fc.integer({ max: 99_999, min: 1 }),
        (balance, rate) => {
          const usd = Money.fromMinorUnits(balance, currencies[1]);
          const progress = (
            quotes: readonly string[],
          ): ReturnType<typeof calculateGoalProgress> =>
            calculateGoalProgress({
              goal,
              now: at,
              positions: new Map([
                [
                  'usd',
                  {
                    accountId: 'usd',
                    balance: usd,
                    declaredAmountShares: Money.fromMinorUnits(
                      0n,
                      currencies[1],
                    ),
                    lifecycle: 'active' as const,
                  },
                ],
              ]),
              quotes: quotes.map((value, index) => ({
                effectiveAt: new Date(at.getTime() - 1000 * (index + 1)),
                id: `q${String(index)}`,
                rate: value,
                source: 'manual',
                sourceCurrencyCode: 'USD',
                targetCurrencyCode: 'BRL',
              })),
              today: CivilDate.parse('2026-11-26'),
            });
          const without = progress([]);
          const quoted = progress([`${String(rate)}.0001`]);
          expect(without.lines[0]?.counted.equals(usd)).toBe(true);
          expect(quoted.lines[0]?.counted.equals(usd)).toBe(true);
          if (usd.isZero()) return;
          expect(without.accumulated).toBeNull();
          expect(quoted.accumulated).not.toBeNull();
        },
      ),
    );
  });

  it('budget consumption: planned = realized + remaining − excess, never negative', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ max: 10n ** 12n, min: 1n }),
        minor,
        (limit, spent) => {
          const unit = currencies[0];
          const planned = Money.fromMinorUnits(limit, unit);
          const realized = Money.fromMinorUnits(spent, unit);
          const result = calculateBudgetConsumption(planned, realized);
          expect(
            result.realized
              .add(result.remaining)
              .subtract(result.excess)
              .equals(planned),
          ).toBe(true);
          expect(result.remaining.toMinorUnits() >= 0n).toBe(true);
          expect(result.excess.toMinorUnits() >= 0n).toBe(true);
          expect(result.exceeded).toBe(spent > limit);
        },
      ),
    );
  });

  it('a limit change never rewrites a past month', () => {
    fc.assert(
      fc.property(
        fc.integer({ max: 11, min: 0 }),
        fc.integer({ max: 24, min: 0 }),
        (shift, later) => {
          const unit = currencies[0];
          const budget = Budget.create({
            createdAt: at,
            dimension: { id: 'a', kind: 'account' },
            effectiveFrom: '2026-01',
            id: 'b',
            limit: Money.fromDecimal('100.00', unit),
            name: 'B',
            ownerId: 'o',
          });
          const month = (offset: number): string => {
            const index = offset;
            return `${String(2026 + Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`;
          };
          const current = month(shift);
          const from = month(shift + later);
          const before = Array.from({ length: shift + 1 }, (_, i) =>
            budget.limitFor(month(i))?.toDecimal(),
          );
          budget.change(
            {
              currentMonth: current,
              effectiveFrom: from,
              limit: Money.fromDecimal('250.00', unit),
              name: 'B',
            },
            at,
          );
          const pastMonths = Array.from({ length: shift }, (_, i) => month(i));
          for (const [index, value] of pastMonths.entries()) {
            expect(budget.limitFor(value)?.toDecimal()).toBe(before[index]);
          }
          expect(budget.limitFor(from)?.toDecimal()).toBe('250.00');
        },
      ),
    );
  });
});
