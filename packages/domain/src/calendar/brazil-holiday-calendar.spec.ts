import { describe, expect, it } from 'vitest';

import {
  brazilHolidayPredicate,
  brazilHolidaysIn,
  easterSunday,
  InvalidHolidayLocationError,
} from './brazil-holiday-calendar.js';
import { CAPITAL_HOLIDAYS, STATE_HOLIDAYS } from './brazil-holiday-rules.js';
import { CivilDate } from './civil-date.js';

const nowhere = { municipalityCode: null, stateCode: null } as const;

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
  ])('computes Easter %s', (year, expected) => {
    expect(easterSunday(year).toString()).toBe(expected);
  });
});

describe('brazilHolidaysIn', () => {
  it('includes national and bank-calendar holidays for 2026', () => {
    const dates = brazilHolidaysIn(2026, nowhere);

    for (const date of [
      '2026-01-01',
      '2026-02-16',
      '2026-02-17',
      '2026-04-03',
      '2026-04-21',
      '2026-11-20',
      '2026-12-25',
      '2026-12-31',
    ]) {
      expect(dates.has(date)).toBe(true);
    }
    expect(dates.has('2026-06-04')).toBe(false);
  });

  it('applies Consciência Negra only from 2024', () => {
    expect(brazilHolidaysIn(2023, nowhere).has('2023-11-20')).toBe(false);
  });

  it('adds state, capital and easter-relative local holidays', () => {
    expect(
      brazilHolidaysIn(2026, { municipalityCode: null, stateCode: 'ES' }).has(
        '2026-04-13',
      ),
    ).toBe(true);
    const salvador = brazilHolidaysIn(2026, {
      municipalityCode: '2927408',
      stateCode: 'BA',
    });
    expect(salvador.has('2026-07-02')).toBe(true);
    expect(salvador.has('2026-06-04')).toBe(true);
  });

  it('moves Santa Catarina holidays to the following Sunday', () => {
    const sc = brazilHolidaysIn(2026, {
      municipalityCode: null,
      stateCode: 'SC',
    });

    expect(sc.has('2026-08-16')).toBe(true);
    expect(sc.has('2026-11-29')).toBe(true);
    expect(sc.has('2026-08-11')).toBe(false);
  });

  it('adds holder-declared municipal holidays', () => {
    const dates = brazilHolidaysIn(
      2026,
      { municipalityCode: '3509502', stateCode: 'SP' },
      [
        { day: 7, month: 3, year: null },
        { day: 8, month: 3, year: 2027 },
      ],
    );

    expect(dates.has('2026-03-07')).toBe(true);
    expect(dates.has('2026-03-08')).toBe(false);
  });

  it.each([
    [{ municipalityCode: null, stateCode: 'XX' }],
    [{ municipalityCode: '3550308', stateCode: null }],
    [{ municipalityCode: '3550308', stateCode: 'RJ' }],
    [{ municipalityCode: '355030', stateCode: 'SP' }],
  ])('rejects an invalid location %j', (location) => {
    expect(() => brazilHolidaysIn(2026, location)).toThrow(
      InvalidHolidayLocationError,
    );
  });
});

describe('dataset', () => {
  it('covers all 27 federative units and their capitals', () => {
    expect(Object.keys(STATE_HOLIDAYS)).toHaveLength(27);
    const capitals = Object.values(CAPITAL_HOLIDAYS);
    expect(capitals).toHaveLength(27);
    expect(new Set(capitals.map((capital) => capital.stateCode)).size).toBe(27);
  });

  it('materializes every rule for a range of years', () => {
    for (let year = 2020; year <= 2040; year += 1) {
      for (const stateCode of Object.keys(STATE_HOLIDAYS)) {
        expect(() =>
          brazilHolidaysIn(year, { municipalityCode: null, stateCode }),
        ).not.toThrow();
      }
      for (const [code, capital] of Object.entries(CAPITAL_HOLIDAYS)) {
        expect(() =>
          brazilHolidaysIn(year, {
            municipalityCode: code,
            stateCode: capital.stateCode,
          }),
        ).not.toThrow();
      }
    }
  });
});

describe('brazilHolidayPredicate', () => {
  it('answers per civil date at the configured location', () => {
    const isHoliday = brazilHolidayPredicate({
      municipalityCode: '3550308',
      stateCode: 'SP',
    });

    expect(isHoliday(CivilDate.parse('2026-07-09'))).toBe(true);
    expect(isHoliday(CivilDate.parse('2027-01-25'))).toBe(true);
    expect(isHoliday(CivilDate.parse('2026-07-10'))).toBe(false);
  });
});
