import { CivilDate } from '../calendar/civil-date.js';

/**
 * Where a purchase made on the closing date belongs (RII-015).
 * `next-cycle` (default): the closing date opens the next invoice.
 * `closing-cycle`: the closing date is the last day of the closing invoice.
 */
export type CardClosingBoundary = 'next-cycle' | 'closing-cycle';

export const CARD_CLOSING_BOUNDARIES: readonly CardClosingBoundary[] = [
  'next-cycle',
  'closing-cycle',
];

export const DEFAULT_CARD_CLOSING_BOUNDARY: CardClosingBoundary = 'next-cycle';

/** True when the civil date is a holiday at the holder's configured location. */
export type HolidayPredicate = (date: CivilDate) => boolean;

export type CardCycleScheduleProperties = Readonly<{
  closingBoundary: CardClosingBoundary;
  /** 1–31, or null when the holder has not configured it yet. */
  closingDay: number | null;
  /** 1–31, or null when the holder has not configured it yet. */
  dueDay: number | null;
}>;

export type CardCycle = Readonly<{
  /** First civil date whose purchases belong to this cycle. */
  firstPurchaseDate: CivilDate;
  /** Last civil date whose purchases belong to this cycle. */
  lastPurchaseDate: CivilDate;
  /** Closing date materialized for the month (clamped, never shifted). */
  closesOn: CivilDate;
  /** Due date before the business-day shift. */
  scheduledDueOn: CivilDate;
  /** Due date after skipping weekends and holidays. */
  dueOn: CivilDate;
  /** True when a missing closing or due day fell back to the month end. */
  configurationPending: boolean;
}>;

export class InvalidCardCycleScheduleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCardCycleScheduleError';
  }
}

const LAST_DAY = 31;
const MAX_BUSINESS_DAY_SEARCH = 31;

/** Deterministic civil-calendar rules for a card cycle (RII-015). */
export class CardCycleSchedule {
  private constructor(private readonly state: CardCycleScheduleProperties) {}

  public static create(
    properties: CardCycleScheduleProperties,
  ): CardCycleSchedule {
    assertOptionalDay(properties.closingDay, 'Closing day');
    assertOptionalDay(properties.dueDay, 'Due day');
    if (!CARD_CLOSING_BOUNDARIES.includes(properties.closingBoundary)) {
      throw new InvalidCardCycleScheduleError('Unknown closing boundary.');
    }
    return new CardCycleSchedule({ ...properties });
  }

  /** The single cycle that contains a purchase made on `purchaseDate`. */
  public cycleFor(
    purchaseDate: CivilDate,
    isHoliday: HolidayPredicate,
  ): CardCycle {
    const sameMonthClose = this.closingIn(
      purchaseDate.year,
      purchaseDate.month,
    );
    const closesOn = this.belongsToCycleClosingOn(purchaseDate, sameMonthClose)
      ? sameMonthClose
      : sameMonthClose.addMonthsClamped(1, this.closingDay);
    return this.cycleClosingOn(closesOn, isHoliday);
  }

  /** The cycle that closes in the given civil month. */
  public cycleClosingIn(
    year: number,
    month: number,
    isHoliday: HolidayPredicate,
  ): CardCycle {
    return this.cycleClosingOn(this.closingIn(year, month), isHoliday);
  }

  private cycleClosingOn(
    closesOn: CivilDate,
    isHoliday: HolidayPredicate,
  ): CardCycle {
    const previousClose = closesOn.addMonthsClamped(-1, this.closingDay);
    const nextCycle = this.state.closingBoundary === 'next-cycle';
    const scheduledDueOn = closesOn.addMonthsClamped(
      this.dueDay <= this.closingDay ? 1 : 0,
      this.dueDay,
    );
    return {
      closesOn,
      configurationPending:
        this.state.closingDay === null || this.state.dueDay === null,
      dueOn: nextBusinessDay(scheduledDueOn, isHoliday),
      firstPurchaseDate: nextCycle ? previousClose : previousClose.addDays(1),
      lastPurchaseDate: nextCycle ? closesOn.addDays(-1) : closesOn,
      scheduledDueOn,
    };
  }

  private belongsToCycleClosingOn(
    purchaseDate: CivilDate,
    closesOn: CivilDate,
  ): boolean {
    const order = purchaseDate.compare(closesOn);
    return this.state.closingBoundary === 'next-cycle' ? order < 0 : order <= 0;
  }

  private closingIn(year: number, month: number): CivilDate {
    return CivilDate.ofClampedDay(year, month, this.closingDay);
  }

  private get closingDay(): number {
    return this.state.closingDay ?? LAST_DAY;
  }

  private get dueDay(): number {
    return this.state.dueDay ?? LAST_DAY;
  }
}

/** First date on or after `date` that is neither weekend nor holiday. */
export function nextBusinessDay(
  date: CivilDate,
  isHoliday: HolidayPredicate,
): CivilDate {
  let candidate = date;
  for (let step = 0; step <= MAX_BUSINESS_DAY_SEARCH; step += 1) {
    if (!candidate.isWeekend && !isHoliday(candidate)) return candidate;
    candidate = candidate.addDays(1);
  }
  throw new InvalidCardCycleScheduleError(
    'No business day found within a month of the scheduled date.',
  );
}

function assertOptionalDay(value: number | null, label: string): void {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value < 1 || value > LAST_DAY) {
    throw new InvalidCardCycleScheduleError(
      `${label} must be between 1 and 31.`,
    );
  }
}
