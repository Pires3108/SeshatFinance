import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { CardCycleSchedule } from './card-cycle-schedule.js';
import {
  deriveInvoiceDueState,
  InvalidInvoiceAttentionDaysError,
} from './invoice-due-state.js';

const d = (value: string): CivilDate => CivilDate.parse(value);
const base = {
  attentionDays: 5,
  dueOn: d('2026-11-09'),
  purchasesMinorUnits: 13035n,
  remainingMinorUnits: 13035n,
};

describe('deriveInvoiceDueState', () => {
  it.each([
    ['2026-11-03', 'on-time', 6],
    ['2026-11-04', 'attention', 5],
    ['2026-11-09', 'attention', 0],
    ['2026-11-10', 'overdue', -1],
  ])('on %s the invoice is %s', (today, state, days) => {
    expect(deriveInvoiceDueState({ ...base, today: d(today) })).toEqual({
      daysUntilDue: days,
      state,
    });
  });

  it('removes the debt state after full payment, even when past due', () => {
    expect(
      deriveInvoiceDueState({
        ...base,
        remainingMinorUnits: 0n,
        today: d('2026-12-01'),
      }).state,
    ).toBe('paid');
  });

  it('keeps an overdue invoice overdue after a partial payment', () => {
    expect(
      deriveInvoiceDueState({
        ...base,
        remainingMinorUnits: 35n,
        today: d('2026-11-10'),
      }).state,
    ).toBe('overdue');
  });

  it('never flags a future invoice as overdue', () => {
    expect(
      deriveInvoiceDueState({ ...base, today: d('2026-10-01') }).state,
    ).toBe('on-time');
  });

  it('reports an empty invoice as having no purchases', () => {
    expect(
      deriveInvoiceDueState({
        ...base,
        purchasesMinorUnits: 0n,
        remainingMinorUnits: 0n,
        today: d('2026-12-01'),
      }).state,
    ).toBe('no-purchases');
  });

  it('uses the effective due date after a holiday in a short month', () => {
    // Closing day 31 clamps to 28/02/2026; due day 28 ≤ 31 moves to the
    // next month: 28/03/2026 is a Saturday and 30/03 a holiday → 31/03.
    const cycle = CardCycleSchedule.create({
      closingBoundary: 'next-cycle',
      closingDay: 31,
      dueDay: 28,
    }).cycleClosingIn(2026, 2, (date) => date.toString() === '2026-03-30');
    expect(cycle.scheduledDueOn.toString()).toBe('2026-03-28');
    expect(cycle.dueOn.toString()).toBe('2026-03-31');
    expect(
      deriveInvoiceDueState({
        ...base,
        dueOn: cycle.dueOn,
        today: d('2026-03-30'),
      }).state,
    ).toBe('attention');
  });

  it.each([-1, 31, 2.5])('rejects attention days %s', (attentionDays) => {
    expect(() =>
      deriveInvoiceDueState({ ...base, attentionDays, today: d('2026-11-01') }),
    ).toThrow(InvalidInvoiceAttentionDaysError);
  });
});
