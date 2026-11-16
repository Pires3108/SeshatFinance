import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InterestRate } from '../interest/interest-rate.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import {
  calculateLoanSchedule,
  InvalidLoanScheduleError,
  type LoanSchedule,
} from './loan-schedule.js';

const brl = Currency.create('BRL', 2);
const money = (amount: string): Money => Money.fromDecimal(amount, brl);
const monthly = (
  method: 'simple' | 'compound',
  percentPerPeriod: string,
): InterestRate =>
  InterestRate.create({ method, percentPerPeriod, periodicity: 'monthly' });
const lines = (schedule: LoanSchedule): (readonly [bigint, bigint, bigint])[] =>
  schedule.lines.map((line) => [line.amount, line.principal, line.interest]);

/** Properties replay hundreds of schedules; keep clear of the 5 s default. */
const PROPERTY_TIMEOUT_MS = 30_000;

describe('calculateLoanSchedule (ADR-042)', () => {
  it('builds a Price schedule with equal installments and the residual last', () => {
    const schedule = calculateLoanSchedule({
      count: 3,
      principal: money('1000.00'),
      profile: 'constant',
      rate: monthly('compound', '1'),
    });

    expect(schedule.total).toBe(102_007n);
    expect(lines(schedule)).toEqual([
      [34_002n, 33_002n, 1_000n],
      [34_002n, 33_332n, 670n],
      [34_003n, 33_666n, 337n],
    ]);
  });

  it('builds a SAC schedule with equal amortization and decreasing interest', () => {
    const schedule = calculateLoanSchedule({
      count: 3,
      principal: money('1000.00'),
      profile: 'decreasing',
      rate: monthly('compound', '1'),
    });

    expect(lines(schedule)).toEqual([
      [34_333n, 33_333n, 1_000n],
      [34_000n, 33_333n, 667n],
      [33_667n, 33_334n, 333n],
    ]);
  });

  it('uses the RN-020 simple total for a constant simple-interest loan', () => {
    const schedule = calculateLoanSchedule({
      count: 2,
      principal: money('100.00'),
      profile: 'constant',
      rate: monthly('simple', '1'),
    });

    expect(schedule.total).toBe(10_200n);
    expect(schedule.interest).toBe(200n);
  });

  it('accepts declared increasing installments that close the total', () => {
    const schedule = calculateLoanSchedule({
      count: 3,
      declaredAmounts: [money('30.00'), money('35.00'), money('40.00')],
      principal: money('100.00'),
      profile: 'declared',
      rate: null,
    });

    expect(schedule.total).toBe(10_500n);
    expect(schedule.interest).toBe(500n);
    expect(schedule.lines.map((line) => line.amount)).toEqual([
      3_000n,
      3_500n,
      4_000n,
    ]);
  });

  it('splits the principal when there is no rate', () => {
    const schedule = calculateLoanSchedule({
      count: 3,
      principal: money('100.00'),
      profile: 'constant',
      rate: null,
    });

    expect(lines(schedule)).toEqual([
      [3_333n, 3_333n, 0n],
      [3_333n, 3_333n, 0n],
      [3_334n, 3_334n, 0n],
    ]);
  });

  it.each([
    ['zero installments', { count: 0 }],
    ['installment below one cent', { count: 3, principal: money('0.02') }],
    [
      'declared amounts below the principal',
      {
        declaredAmounts: [money('10.00'), money('10.00')],
        profile: 'declared' as const,
      },
    ],
    [
      'declared amounts with a missing installment',
      {
        declaredAmounts: [money('100.00')],
        profile: 'declared' as const,
      },
    ],
    [
      'declared amounts on another profile',
      {
        declaredAmounts: [money('50.00'), money('50.00')],
      },
    ],
  ])('rejects %s', (_label, change) => {
    expect(() =>
      calculateLoanSchedule({
        count: 2,
        principal: money('100.00'),
        profile: 'constant',
        rate: null,
        ...change,
      }),
    ).toThrow(InvalidLoanScheduleError);
  });

  it(
    'closes principal, interest and total with no negative component (INV-005, INV-019)',
    () => {
      fc.assert(
        fc.property(
          fc.record({
            count: fc.integer({ min: 1, max: 420 }),
            method: fc.constantFrom('simple', 'compound'),
            percent: fc
              .tuple(
                fc.integer({ min: 0, max: 99 }),
                fc.integer({ min: 0, max: 999_999 }),
              )
              .map(
                ([integer, fraction]) =>
                  `${String(integer)}.${String(fraction).padStart(6, '0')}`,
              ),
            principalUnits: fc.bigInt({ min: 420n, max: 100_000_000_000n }),
            profile: fc.constantFrom('constant', 'decreasing'),
            withRate: fc.boolean(),
          }),
          ({ count, method, percent, principalUnits, profile, withRate }) => {
            const schedule = calculateLoanSchedule({
              count,
              principal: Money.fromMinorUnits(principalUnits, brl),
              profile,
              rate: withRate ? monthly(method, percent) : null,
            });
            const sum = (
              pick: (line: LoanSchedule['lines'][number]) => bigint,
            ): bigint =>
              schedule.lines.reduce((acc, line) => acc + pick(line), 0n);

            expect(schedule.lines).toHaveLength(count);
            expect(sum((line) => line.principal)).toBe(principalUnits);
            expect(sum((line) => line.interest)).toBe(schedule.interest);
            expect(sum((line) => line.amount)).toBe(schedule.total);
            for (const line of schedule.lines) {
              expect(line.principal).toBeGreaterThanOrEqual(0n);
              expect(line.interest).toBeGreaterThanOrEqual(0n);
            }
          },
        ),
        { numRuns: 150 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
