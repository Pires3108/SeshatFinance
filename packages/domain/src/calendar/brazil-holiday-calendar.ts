import type { HolidayPredicate } from '../cards/card-cycle-schedule.js';
import {
  BRAZIL_HOLIDAY_DATASET_VERSION,
  CAPITAL_HOLIDAYS,
  NATIONAL_HOLIDAYS,
  STATE_HOLIDAYS,
  type HolidayDefinition,
  type HolidayRule,
} from './brazil-holiday-rules.js';
import { CivilDate } from './civil-date.js';

export class InvalidHolidayLocationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidHolidayLocationError';
  }
}

/** Where the holder lives; both parts are optional until configured. */
export type HolidayLocation = Readonly<{
  /** Brazilian UF, e.g. "SP". */
  stateCode: string | null;
  /** 7-digit IBGE municipality code. */
  municipalityCode: string | null;
}>;

/** Municipal holiday declared by the holder for their own location. */
export type DeclaredHoliday = Readonly<{
  month: number;
  day: number;
  /** null repeats every year. */
  year: number | null;
}>;

const IBGE_MUNICIPALITY = /^\d{7}$/u;

export function isSupportedStateCode(value: string): boolean {
  return Object.hasOwn(STATE_HOLIDAYS, value);
}

export function assertHolidayLocation(location: HolidayLocation): void {
  if (
    location.stateCode !== null &&
    !isSupportedStateCode(location.stateCode)
  ) {
    throw new InvalidHolidayLocationError('Unknown Brazilian state code.');
  }
  if (location.municipalityCode === null) return;
  if (location.stateCode === null) {
    throw new InvalidHolidayLocationError(
      'A municipality requires its state code.',
    );
  }
  if (!IBGE_MUNICIPALITY.test(location.municipalityCode)) {
    throw new InvalidHolidayLocationError(
      'Municipality must be a 7-digit IBGE code.',
    );
  }
  const capital = CAPITAL_HOLIDAYS[location.municipalityCode];
  const stateDigits = ibgeStatePrefix(location.stateCode);
  if (
    (capital !== undefined && capital.stateCode !== location.stateCode) ||
    (stateDigits !== undefined &&
      !location.municipalityCode.startsWith(stateDigits))
  ) {
    throw new InvalidHolidayLocationError(
      'Municipality does not belong to the given state.',
    );
  }
}

/** Gregorian Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return CivilDate.of(year, month, day);
}

/** Holiday dates of one year at a location, as ISO strings. */
export function brazilHolidaysIn(
  year: number,
  location: HolidayLocation,
  declared: readonly DeclaredHoliday[] = [],
): ReadonlySet<string> {
  assertHolidayLocation(location);
  const definitions: HolidayDefinition[] = [...NATIONAL_HOLIDAYS];
  if (location.stateCode !== null) {
    definitions.push(...(STATE_HOLIDAYS[location.stateCode] ?? []));
  }
  if (location.municipalityCode !== null) {
    definitions.push(
      ...(CAPITAL_HOLIDAYS[location.municipalityCode]?.holidays ?? []),
    );
  }
  const dates = new Set<string>();
  for (const definition of definitions) {
    if (definition.validFrom !== undefined && year < definition.validFrom) {
      continue;
    }
    dates.add(materialize(definition.rule, year).toString());
  }
  for (const holiday of declared) {
    if (holiday.year !== null && holiday.year !== year) continue;
    if (holiday.day > CivilDate.daysInMonth(year, holiday.month)) continue;
    dates.add(CivilDate.of(year, holiday.month, holiday.day).toString());
  }
  return dates;
}

/** Cached per-year predicate for a holder's location. */
export function brazilHolidayPredicate(
  location: HolidayLocation,
  declared: readonly DeclaredHoliday[] = [],
): HolidayPredicate {
  assertHolidayLocation(location);
  const byYear = new Map<number, ReadonlySet<string>>();
  return (date) => {
    let dates = byYear.get(date.year);
    if (dates === undefined) {
      dates = brazilHolidaysIn(date.year, location, declared);
      byYear.set(date.year, dates);
    }
    return dates.has(date.toString());
  };
}

export { BRAZIL_HOLIDAY_DATASET_VERSION };

function materialize(rule: HolidayRule, year: number): CivilDate {
  switch (rule.kind) {
    case 'fixed':
      return CivilDate.of(year, rule.month, rule.day);
    case 'easter':
      return easterSunday(year).addDays(rule.offsetDays);
    case 'fixed-moved-to-sunday': {
      const date = CivilDate.of(year, rule.month, rule.day);
      return date.addDays(7 - date.isoWeekday);
    }
  }
}

/** First two IBGE digits identify the state. */
const IBGE_STATE_PREFIX: Readonly<Record<string, string>> = {
  AC: '12',
  AL: '27',
  AM: '13',
  AP: '16',
  BA: '29',
  CE: '23',
  DF: '53',
  ES: '32',
  GO: '52',
  MA: '21',
  MG: '31',
  MS: '50',
  MT: '51',
  PA: '15',
  PB: '25',
  PE: '26',
  PI: '22',
  PR: '41',
  RJ: '33',
  RN: '24',
  RO: '11',
  RR: '14',
  RS: '43',
  SC: '42',
  SE: '28',
  SP: '35',
  TO: '17',
};

function ibgeStatePrefix(stateCode: string): string | undefined {
  return IBGE_STATE_PREFIX[stateCode];
}
