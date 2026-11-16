import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { calculateInstallmentPlan } from '../installments/installment-plan.js';
import { InterestRate } from '../interest/interest-rate.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import {
  CardInstallmentPlan,
  InvalidCardInstallmentPlanError,
} from './card-installment-plan.js';

const brl = Currency.create('BRL', 2);
const plan = calculateInstallmentPlan({
  count: 3,
  principal: Money.fromDecimal('100.00', brl),
  rate: InterestRate.create({
    method: 'compound',
    percentPerPeriod: '1',
    periodicity: 'monthly',
  }),
});
const cycles = ['2026-11-28', '2026-12-28', '2027-01-28'].map((value) =>
  CivilDate.parse(value),
);
const base = {
  cardId: 'card-id',
  createdAt: new Date('2026-11-16T12:00:00.000Z'),
  cycles,
  id: 'plan-id',
  installmentIds: ['i-1', 'i-2', 'i-3'],
  ownerId: 'owner-id',
  plan,
  purchaseId: 'purchase-id',
};

describe('CardInstallmentPlan', () => {
  it('freezes parameters, schedule and the cycle of each installment', () => {
    const created = CardInstallmentPlan.create(base);
    const snapshot = created.toSnapshot();

    expect(snapshot.total.amount).toBe('103.03');
    expect(snapshot.rate).toEqual({
      method: 'compound',
      percentPerPeriod: '1',
      periodicity: 'monthly',
    });
    expect(snapshot.installments.map((item) => item.amount.amount)).toEqual([
      '34.34',
      '34.34',
      '34.35',
    ]);
    expect(snapshot.installments.map((item) => item.cycleClosesOn)).toEqual([
      '2026-11-28',
      '2026-12-28',
      '2027-01-28',
    ]);
    expect(created.firstCycleClosesOn.toString()).toBe('2026-11-28');
  });

  it('restores a stored plan only when it matches its parameters', () => {
    const snapshot = CardInstallmentPlan.create(base).toSnapshot();

    expect(CardInstallmentPlan.restore(snapshot).toSnapshot()).toEqual(
      snapshot,
    );
    const tampered = {
      ...snapshot,
      installments: snapshot.installments.map((item, index) =>
        index === 0
          ? { ...item, amount: { ...item.amount, amount: '34.33' } }
          : item,
      ),
    };
    expect(() => CardInstallmentPlan.restore(tampered)).toThrow(
      InvalidCardInstallmentPlanError,
    );
  });

  it.each([
    ['missing cycle', { cycles: cycles.slice(0, 2) }],
    ['repeated cycle', { cycles: [cycles[0], cycles[0], cycles[2]] }],
    ['out of order cycle', { cycles: [cycles[1], cycles[0], cycles[2]] }],
    ['duplicate id', { installmentIds: ['i-1', 'i-1', 'i-3'] }],
    ['blank purchase', { purchaseId: ' ' }],
  ])('rejects %s', (_label, change) => {
    expect(() =>
      CardInstallmentPlan.create({ ...base, ...change } as typeof base),
    ).toThrow(InvalidCardInstallmentPlanError);
  });
});
