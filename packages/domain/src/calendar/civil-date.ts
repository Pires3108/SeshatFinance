export class InvalidCivilDateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCivilDateError';
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 86_400_000;

/** Calendar date without time or zone (ISO 8601, proleptic Gregorian). */
export class CivilDate {
  private constructor(
    public readonly year: number,
    public readonly month: number,
    public readonly day: number,
  ) {}

  public static of(year: number, month: number, day: number): CivilDate {
    if (
      !Number.isSafeInteger(year) ||
      year < 1 ||
      year > 9999 ||
      !Number.isSafeInteger(month) ||
      month < 1 ||
      month > 12 ||
      !Number.isSafeInteger(day) ||
      day < 1 ||
      day > CivilDate.daysInMonth(year, month)
    ) {
      throw new InvalidCivilDateError(
        `Invalid civil date ${String(year)}-${String(month)}-${String(day)}.`,
      );
    }
    return new CivilDate(year, month, day);
  }

  public static parse(value: string): CivilDate {
    const match = ISO_DATE.exec(value);
    if (match === null) {
      throw new InvalidCivilDateError(`Invalid ISO civil date "${value}".`);
    }
    return CivilDate.of(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  public static daysInMonth(year: number, month: number): number {
    const date = new Date(0);
    date.setUTCFullYear(year, month, 0);
    return date.getUTCDate();
  }

  /** Clamps a configured day (1–31) to the last day of a shorter month. */
  public static ofClampedDay(
    year: number,
    month: number,
    day: number,
  ): CivilDate {
    return CivilDate.of(
      year,
      month,
      Math.min(day, CivilDate.daysInMonth(year, month)),
    );
  }

  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  public get isoWeekday(): number {
    const weekday = new Date(this.toEpochMs()).getUTCDay();
    return weekday === 0 ? 7 : weekday;
  }

  public get isWeekend(): boolean {
    return this.isoWeekday >= 6;
  }

  public addDays(days: number): CivilDate {
    if (!Number.isSafeInteger(days)) {
      throw new InvalidCivilDateError('Day offset must be an integer.');
    }
    const shifted = new Date(this.toEpochMs() + days * DAY_MS);
    return CivilDate.of(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
    );
  }

  /** Same configured day in the month offset by `months`, clamped. */
  public addMonthsClamped(months: number, configuredDay: number): CivilDate {
    const index = this.year * 12 + (this.month - 1) + months;
    return CivilDate.ofClampedDay(
      Math.floor(index / 12),
      (index % 12) + 1,
      configuredDay,
    );
  }

  public compare(other: CivilDate): number {
    return this.toEpochMs() - other.toEpochMs();
  }

  public equals(other: CivilDate): boolean {
    return this.compare(other) === 0;
  }

  public toString(): string {
    return `${String(this.year).padStart(4, '0')}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`;
  }

  private toEpochMs(): number {
    const date = new Date(0);
    date.setUTCFullYear(this.year, this.month - 1, this.day);
    return date.getTime();
  }
}
