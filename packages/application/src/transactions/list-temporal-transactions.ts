import { Money, type Transaction } from '@seshat/domain';

import type { UserProfileRepository } from '../users/update-own-user-profile.js';

export type TemporalPeriod = 'day' | 'week' | 'month';
export type TemporalTransaction = Readonly<{
  transaction: Transaction;
  timeZone: string;
}>;

export interface TemporalTransactionRepository {
  listWithTimeZoneForOwnerBetween(
    ownerId: string,
    from: Date,
    to: Date,
    lifecycle: 'active',
  ): Promise<readonly TemporalTransaction[]>;
}

export type TemporalTotal = Readonly<{
  currencyCode: string;
  currencyMinorUnitScale: number;
  income: string;
  expense: string;
}>;
export type TemporalDay = Readonly<{
  date: string;
  transactions: readonly TemporalTransaction[];
  totals: readonly TemporalTotal[];
}>;
export type TemporalView = Readonly<{
  period: TemporalPeriod;
  selectedDate: string;
  timeZone: string;
  from: Date;
  to: Date;
  days: readonly TemporalDay[];
  totals: readonly TemporalTotal[];
}>;

export class InvalidTemporalSelectionError extends Error {
  public constructor() {
    super('Invalid temporal selection.');
    this.name = 'InvalidTemporalSelectionError';
  }
}

export class TemporalProfileUnavailableError extends Error {
  public constructor() {
    super('Temporal profile unavailable.');
    this.name = 'TemporalProfileUnavailableError';
  }
}

export class ListTemporalTransactionsUseCase {
  public constructor(
    private readonly transactions: TemporalTransactionRepository,
    private readonly profiles: UserProfileRepository,
  ) {}

  public async execute(
    actorId: string,
    period: TemporalPeriod,
    selectedDate: string,
  ): Promise<TemporalView> {
    const selected = parseDate(selectedDate);
    if (selected === null || !['day', 'week', 'month'].includes(period))
      throw new InvalidTemporalSelectionError();
    const profile = await this.profiles.findById(actorId);
    if (profile === null) throw new TemporalProfileUnavailableError();
    const timeZone = profile.timeZone;
    const start =
      period === 'week'
        ? addDays(selected, -selected.getUTCDay())
        : period === 'month'
          ? new Date(
              Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), 1),
            )
          : selected;
    const end =
      period === 'month'
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
        : addDays(start, period === 'week' ? 7 : 1);
    const from = civilMidnight(start, timeZone);
    const to = civilMidnight(end, timeZone);
    // Each transaction is bucketed by its own zone, so a candidate can sit
    // outside the profile-zone interval; the margin covers every UTC offset.
    const candidates = await this.transactions.listWithTimeZoneForOwnerBetween(
      actorId,
      addDays(start, -1),
      addDays(end, 1),
      'active',
    );
    const byDate = new Map<string, TemporalTransaction[]>();
    for (const candidate of candidates) {
      const date = civilDate(
        candidate.transaction.toSnapshot().occurredAt,
        candidate.timeZone,
      );
      byDate.set(date, [...(byDate.get(date) ?? []), candidate]);
    }
    const days: TemporalDay[] = [];
    for (let day = start; day < end; day = addDays(day, 1)) {
      const date = formatDate(day);
      const items = byDate.get(date) ?? [];
      days.push({ date, transactions: items, totals: sumTotals(items) });
    }
    return {
      period,
      selectedDate,
      timeZone,
      from,
      to,
      days,
      totals: sumTotals(days.flatMap((day) => day.transactions)),
    };
  }
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const year = Number(value.slice(0, 4));
  if (year < 100 || year > 9998) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || formatDate(date) !== value
    ? null
    : date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, count: number): Date {
  return new Date(date.getTime() + count * 24 * 60 * 60 * 1000);
}

function civilDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year').padStart(4, '0')}-${value('month')}-${value('day')}`;
}

function civilMidnight(date: Date, timeZone: string): Date {
  const target = formatDate(date);
  let low = date.getTime() - 48 * 60 * 60 * 1000;
  let high = date.getTime() + 48 * 60 * 60 * 1000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (civilDate(new Date(middle), timeZone) < target) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}

function sumTotals(
  transactions: readonly TemporalTransaction[],
): readonly TemporalTotal[] {
  const totals = new Map<string, { income: Money; expense: Money }>();
  for (const { transaction } of transactions) {
    const amount = transaction.amount;
    const key = `${amount.currency.code}:${String(amount.currency.minorUnitScale)}`;
    const current = totals.get(key) ?? {
      income: Money.fromMinorUnits(0n, amount.currency),
      expense: Money.fromMinorUnits(0n, amount.currency),
    };
    totals.set(
      key,
      transaction.toSnapshot().kind === 'income'
        ? { ...current, income: current.income.add(amount) }
        : { ...current, expense: current.expense.add(amount) },
    );
  }
  return [...totals.values()]
    .map(({ income, expense }) => ({
      currencyCode: income.currency.code,
      currencyMinorUnitScale: income.currency.minorUnitScale,
      income: income.toDecimal(),
      expense: expense.toDecimal(),
    }))
    .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
}
