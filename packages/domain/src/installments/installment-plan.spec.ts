import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InterestRate } from '../interest/interest-rate.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import {
  calculateInstallmentPlan,
  INSTALLMENT_CALCULATION_VERSION,
  InvalidInstallmentPlanError,
  MAX_INSTALLMENT_COUNT,
  type InstallmentPlan,
} from './installment-plan.js';

/** Properties run hundreds of plans; keep them clear of the 5 s default. */
const PROPERTY_TIMEOUT_MS = 30_000;
const brl = Currency.create('BRL', 2);
const money = (amount: string): Money => Money.fromDecimal(amount, brl);
const rate = (
  method: 'simple' | 'compound',
  percentPerPeriod: string,
): InterestRate =>
  InterestRate.create({ method, percentPerPeriod, periodicity: 'monthly' });

const amounts = (plan: InstallmentPlan): string[] =>
  plan.installments.map((installment) => installment.amount.toDecimal());

describe('calculateInstallmentPlan', () => {
  it('leaves the cent difference in the last installment (US-044)', () => {
    const plan = calculateInstallmentPlan({
      count: 3,
      principal: money('100.00'),
      rate: null,
    });

    expect(amounts(plan)).toEqual(['33.33', '33.33', '33.34']);
    expect(plan.total.toDecimal()).toBe('100.00');
    expect(plan.interest.toDecimal()).toBe('0.00');
  });

  it('shows simple interest separately (US-045)', () => {
    const plan = calculateInstallmentPlan({
      count: 2,
      principal: money('100.00'),
      rate: rate('simple', '1'),
    });

    expect(plan.interest.toDecimal()).toBe('2.00');
    expect(plan.total.toDecimal()).toBe('102.00');
    expect(amounts(plan)).toEqual(['51.00', '51.00']);
    expect(plan.memory).toEqual({
      calculationVersion: INSTALLMENT_CALCULATION_VERSION,
      count: 2,
      principal: {
        amount: '100.00',
        currency: { code: 'BRL', minorUnitScale: 2 },
      },
      rate: { method: 'simple', percentPerPeriod: '1', periodicity: 'monthly' },
      rounding: 'half-up-final-total',
      split: 'rn-018-last-receives-residual',
    });
  });

  it('compounds without intermediate rounding (US-045)', () => {
    const plan = calculateInstallmentPlan({
      count: 2,
      principal: money('100.00'),
      rate: rate('compound', '1'),
    });

    expect(plan.total.toDecimal()).toBe('102.01');
    expect(amounts(plan)).toEqual(['51.00', '51.01']);
  });

  it('rounds the exact total half up only once', () => {
    // 0.50 × 1.01^1 = 0.505 → 0.51 (half up), not 0.50 (half even)
    const plan = calculateInstallmentPlan({
      count: 1,
      principal: money('0.50'),
      rate: rate('compound', '1'),
    });

    expect(plan.total.toDecimal()).toBe('0.51');
  });

  it('rounds the compound total once, never per period (RII-007)', () => {
    // Exact 1.00 × 1.015² = 1.030225 → 1.03; rounding each period gives 1.04.
    const plan = calculateInstallmentPlan({
      count: 2,
      principal: money('1.00'),
      rate: rate('compound', '1.5'),
    });

    expect(plan.total.toDecimal()).toBe('1.03');
  });

  it('allocates interest by the cumulative share of each installment (INV-019)', () => {
    // 1.00 at 0.5% simple over 4 periods: total 1.02 split 0.25/0.25/0.25/0.27.
    const plan = calculateInstallmentPlan({
      count: 4,
      principal: money('1.00'),
      rate: rate('simple', '0.5'),
    });

    expect(plan.installments.map((item) => item.interest.toDecimal())).toEqual([
      '0.00',
      '0.00',
      '0.01',
      '0.01',
    ]);
  });

  it('keeps every component non-negative when residuals diverge', () => {
    const plan = calculateInstallmentPlan({
      count: 3,
      principal: money('100.01'),
      rate: rate('simple', '0.0033'),
    });

    for (const installment of plan.installments) {
      expect(installment.interest.toMinorUnits()).toBeGreaterThanOrEqual(0n);
      expect(installment.principal.toMinorUnits()).toBeGreaterThanOrEqual(0n);
    }
  });

  it.each([
    ['compound', '1563.88'],
    ['simple', '1529.37'],
  ] as const)(
    'reproduces %s interest at 1.99%% over 12 periods exactly (US-045)',
    (method, total) => {
      const input = {
        count: 12,
        principal: money('1234.56'),
        rate: rate(method, '1.99'),
      };

      expect(calculateInstallmentPlan(input).total.toDecimal()).toBe(total);
      expect(calculateInstallmentPlan(input).total.toDecimal()).toBe(total);
    },
  );

  it('treats a zero rate as no interest for both methods', () => {
    for (const method of ['simple', 'compound'] as const) {
      const plan = calculateInstallmentPlan({
        count: 7,
        principal: money('99.99'),
        rate: rate(method, '0'),
      });
      expect(plan.interest.toDecimal()).toBe('0.00');
      expect(plan.total.toDecimal()).toBe('99.99');
    }
  });

  it('handles the largest rate over the largest count without losing precision', () => {
    const plan = calculateInstallmentPlan({
      count: MAX_INSTALLMENT_COUNT,
      principal: money('1.00'),
      rate: rate('compound', '100'),
    });

    // 1.00 × 2^420: a 129-digit amount in minor units, kept exactly.
    expect(plan.total.toMinorUnits()).toBe(100n * 2n ** 420n);
    expect(
      plan.installments.reduce(
        (sum, item) => sum + item.amount.toMinorUnits(),
        0n,
      ),
    ).toBe(plan.total.toMinorUnits());
  });

  it.each([
    ['zero installments', { count: 0, principal: money('10.00'), rate: null }],
    ['fractional count', { count: 1.5, principal: money('10.00'), rate: null }],
    [
      'too many installments',
      {
        count: MAX_INSTALLMENT_COUNT + 1,
        principal: money('1000.00'),
        rate: null,
      },
    ],
    ['zero principal', { count: 1, principal: money('0.00'), rate: null }],
    [
      'negative principal',
      { count: 1, principal: money('-10.00'), rate: null },
    ],
    [
      'installment below one cent',
      { count: 3, principal: money('0.02'), rate: null },
    ],
  ])('rejects %s', (_label, input) => {
    expect(() => calculateInstallmentPlan(input)).toThrow(
      InvalidInstallmentPlanError,
    );
  });
});

describe('calculateInstallmentPlan properties (INV-005, INV-019)', () => {
  const currencies = fc.constantFrom(
    Currency.create('BRL', 2),
    Currency.create('USD', 2),
    Currency.create('EUR', 2),
  );
  const percent = fc
    .tuple(
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 999_999 }),
    )
    .map(([integer, fraction]) =>
      integer === 100
        ? '100'
        : `${String(integer)}.${String(fraction).padStart(6, '0')}`,
    );
  const input = fc
    .record({
      count: fc.integer({ min: 1, max: MAX_INSTALLMENT_COUNT }),
      currency: currencies,
      method: fc.constantFrom('simple', 'compound', 'none'),
      percentPerPeriod: percent,
      principalUnits: fc.bigInt({ min: 1n, max: 10_000_000_000n }),
    })
    .filter(({ count, principalUnits }) => principalUnits >= BigInt(count))
    .map(({ count, currency, method, percentPerPeriod, principalUnits }) => ({
      count,
      principal: Money.fromMinorUnits(principalUnits, currency),
      rate:
        method === 'none'
          ? null
          : InterestRate.create({
              method,
              percentPerPeriod,
              periodicity: 'monthly',
            }),
    }));

  it(
    'closes the total, the principal and the interest exactly',
    () => {
      fc.assert(
        fc.property(input, (planInput) => {
          const plan = calculateInstallmentPlan(planInput);
          const sum = (
            pick: (i: InstallmentPlan['installments'][number]) => Money,
          ): bigint =>
            plan.installments.reduce(
              (acc, item) => acc + pick(item).toMinorUnits(),
              0n,
            );

          expect(plan.installments).toHaveLength(planInput.count);
          expect(sum((i) => i.amount)).toBe(plan.total.toMinorUnits());
          expect(sum((i) => i.principal)).toBe(plan.principal.toMinorUnits());
          expect(sum((i) => i.interest)).toBe(plan.interest.toMinorUnits());
          expect(plan.principal.add(plan.interest).equals(plan.total)).toBe(
            true,
          );
          for (const item of plan.installments) {
            expect(
              item.amount.currency.equals(planInput.principal.currency),
            ).toBe(true);
            expect(item.principal.toMinorUnits()).toBeGreaterThanOrEqual(0n);
            expect(item.interest.toMinorUnits()).toBeGreaterThanOrEqual(0n);
            expect(item.principal.add(item.interest).equals(item.amount)).toBe(
              true,
            );
          }
        }),
        { numRuns: 200 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'is deterministic and keeps earlier installments equal',
    () => {
      fc.assert(
        fc.property(input, (planInput) => {
          const first = calculateInstallmentPlan(planInput);
          const second = calculateInstallmentPlan(planInput);
          const regular = first.installments[0]?.amount.toMinorUnits();

          expect(amounts(second)).toEqual(amounts(first));
          for (const item of first.installments.slice(0, -1)) {
            expect(item.amount.toMinorUnits()).toBe(regular);
          }
        }),
        { numRuns: 100 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    'never charges less than the principal',
    () => {
      fc.assert(
        fc.property(input, (planInput) => {
          const plan = calculateInstallmentPlan(planInput);
          expect(plan.total.compare(plan.principal)).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
