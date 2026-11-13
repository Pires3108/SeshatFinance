import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import {
  CardCycleSchedule,
  InvalidCardCycleScheduleError,
  nextBusinessDay,
  type CardCycle,
  type HolidayPredicate,
} from './card-cycle-schedule.js';

const noHolidays: HolidayPredicate = () => false;
const d = (value: string): CivilDate => CivilDate.parse(value);
const view = (cycle: CardCycle): Record<string, unknown> => ({
  closesOn: cycle.closesOn.toString(),
  dueOn: cycle.dueOn.toString(),
  first: cycle.firstPurchaseDate.toString(),
  last: cycle.lastPurchaseDate.toString(),
  pending: cycle.configurationPending,
  scheduledDueOn: cycle.scheduledDueOn.toString(),
});

describe('CardCycleSchedule', () => {
  const nextCycle = CardCycleSchedule.create({
    closingBoundary: 'next-cycle',
    closingDay: 28,
    dueDay: 7,
  });

  it('keeps purchases before the closing date in the closing cycle', () => {
    expect(view(nextCycle.cycleFor(d('2026-10-27'), noHolidays))).toEqual({
      closesOn: '2026-10-28',
      dueOn: '2026-11-09',
      first: '2026-09-28',
      last: '2026-10-27',
      pending: false,
      scheduledDueOn: '2026-11-07',
    });
  });

  it('sends a purchase on the closing date to the next cycle by default', () => {
    expect(
      nextCycle.cycleFor(d('2026-10-28'), noHolidays).closesOn.toString(),
    ).toBe('2026-11-28');
  });

  it('keeps a purchase on the closing date in the closing cycle when configured', () => {
    const closing = CardCycleSchedule.create({
      closingBoundary: 'closing-cycle',
      closingDay: 28,
      dueDay: 7,
    });
    const cycle = closing.cycleFor(d('2026-10-28'), noHolidays);

    expect(cycle.closesOn.toString()).toBe('2026-10-28');
    expect(cycle.firstPurchaseDate.toString()).toBe('2026-09-29');
    expect(cycle.lastPurchaseDate.toString()).toBe('2026-10-28');
  });

  it.each(['next-cycle', 'closing-cycle'] as const)(
    'assigns every day of a year to exactly one contiguous cycle (%s)',
    (closingBoundary) => {
      const schedule = CardCycleSchedule.create({
        closingBoundary,
        closingDay: 31,
        dueDay: 10,
      });
      let day = d('2027-12-25');
      let previous = schedule.cycleFor(day, noHolidays);
      for (let step = 0; step < 800; step += 1) {
        day = day.addDays(1);
        const cycle = schedule.cycleFor(day, noHolidays);
        expect(cycle.firstPurchaseDate.compare(day)).toBeLessThanOrEqual(0);
        expect(cycle.lastPurchaseDate.compare(day)).toBeGreaterThanOrEqual(0);
        if (!cycle.closesOn.equals(previous.closesOn)) {
          expect(cycle.firstPurchaseDate.toString()).toBe(
            previous.lastPurchaseDate.addDays(1).toString(),
          );
        }
        previous = cycle;
      }
    },
  );

  it.each([
    ['2026-02-15', '2026-02-28'],
    ['2028-02-15', '2028-02-29'],
    ['2026-04-15', '2026-04-30'],
  ])('clamps day 31 to the last day of short months (%s)', (date, close) => {
    const schedule = CardCycleSchedule.create({
      closingBoundary: 'next-cycle',
      closingDay: 31,
      dueDay: 10,
    });

    expect(schedule.cycleFor(d(date), noHolidays).closesOn.toString()).toBe(
      close,
    );
  });

  it('moves the due date to the next month when due day equals the closing day', () => {
    const schedule = CardCycleSchedule.create({
      closingBoundary: 'next-cycle',
      closingDay: 10,
      dueDay: 10,
    });

    expect(
      schedule.cycleClosingIn(2026, 12, noHolidays).scheduledDueOn.toString(),
    ).toBe('2027-01-10');
  });

  it('keeps the due date in the closing month when due day is after closing', () => {
    const schedule = CardCycleSchedule.create({
      closingBoundary: 'next-cycle',
      closingDay: 3,
      dueDay: 13,
    });

    expect(
      schedule.cycleClosingIn(2026, 12, noHolidays).scheduledDueOn.toString(),
    ).toBe('2026-12-13');
  });

  it('falls back to the month end and flags pending configuration', () => {
    const schedule = CardCycleSchedule.create({
      closingBoundary: 'next-cycle',
      closingDay: null,
      dueDay: null,
    });

    expect(view(schedule.cycleClosingIn(2027, 1, noHolidays))).toMatchObject({
      closesOn: '2027-01-31',
      pending: true,
      scheduledDueOn: '2027-02-28',
    });
  });

  it('crosses the year when the cycle closes in December', () => {
    expect(
      nextCycle.cycleFor(d('2026-12-30'), noHolidays).closesOn.toString(),
    ).toBe('2027-01-28');
  });

  it('shifts a due date past weekends and holidays', () => {
    const holidays = new Set(['2026-11-02']);
    const isHoliday: HolidayPredicate = (date) => holidays.has(date.toString());

    // 2026-10-31 is a Saturday, 11-01 a Sunday and 11-02 a holiday.
    expect(nextBusinessDay(d('2026-10-31'), isHoliday).toString()).toBe(
      '2026-11-03',
    );
  });

  it.each([0, 32, 2.5])('rejects invalid configured day %s', (day) => {
    expect(() =>
      CardCycleSchedule.create({
        closingBoundary: 'next-cycle',
        closingDay: day,
        dueDay: 5,
      }),
    ).toThrow(InvalidCardCycleScheduleError);
  });
});
