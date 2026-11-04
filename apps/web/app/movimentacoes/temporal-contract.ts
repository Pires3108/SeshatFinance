export type Period = 'day' | 'week' | 'month';
export type MoneyTotal = Readonly<{
  currencyCode: string;
  currencyMinorUnitScale: number;
  income: string;
  expense: string;
}>;
export type TemporalTransaction = Readonly<{
  id: string;
  accountId: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  kind: 'income' | 'expense';
  occurredAt: string;
}>;
export type TemporalView = Readonly<{
  period: Period;
  selectedDate: string;
  timeZone: string;
  from: string;
  to: string;
  days: readonly Readonly<{
    date: string;
    transactions: readonly TemporalTransaction[];
    totals: readonly MoneyTotal[];
  }>[];
  totals: readonly MoneyTotal[];
}>;

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const moneyPattern = /^\d+(?:\.\d+)?$/u;

export function isCivilDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function isPeriod(value: string): value is Period {
  return value === 'day' || value === 'week' || value === 'month';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMoney(value: unknown, scale: number): value is string {
  return (
    typeof value === 'string' &&
    moneyPattern.test(value) &&
    (value.split('.')[1]?.length ?? 0) <= scale
  );
}

function isCurrency(value: Record<string, unknown>): boolean {
  return (
    typeof value.currencyCode === 'string' &&
    /^[A-Z]{3}$/u.test(value.currencyCode) &&
    typeof value.currencyMinorUnitScale === 'number' &&
    Number.isInteger(value.currencyMinorUnitScale) &&
    value.currencyMinorUnitScale >= 0 &&
    value.currencyMinorUnitScale <= 18
  );
}

function isTotal(value: unknown): value is MoneyTotal {
  if (!isRecord(value) || !isCurrency(value)) return false;
  const scale = value.currencyMinorUnitScale as number;
  return isMoney(value.income, scale) && isMoney(value.expense, scale);
}

function isTransaction(value: unknown): value is TemporalTransaction {
  if (!isRecord(value) || !isCurrency(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.accountId === 'string' &&
    isMoney(value.amount, value.currencyMinorUnitScale as number) &&
    (value.description === null || typeof value.description === 'string') &&
    (value.kind === 'income' || value.kind === 'expense') &&
    typeof value.occurredAt === 'string' &&
    !Number.isNaN(Date.parse(value.occurredAt))
  );
}

export function isTemporalView(value: unknown): value is TemporalView {
  if (!isRecord(value)) return false;
  if (
    typeof value.period !== 'string' ||
    !isPeriod(value.period) ||
    typeof value.selectedDate !== 'string' ||
    !isCivilDate(value.selectedDate) ||
    typeof value.timeZone !== 'string' ||
    typeof value.from !== 'string' ||
    Number.isNaN(Date.parse(value.from)) ||
    typeof value.to !== 'string' ||
    Number.isNaN(Date.parse(value.to)) ||
    !Array.isArray(value.days) ||
    !Array.isArray(value.totals) ||
    !value.totals.every(isTotal)
  )
    return false;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value.timeZone });
  } catch {
    return false;
  }
  return value.days.every(
    (day: unknown) =>
      isRecord(day) &&
      typeof day.date === 'string' &&
      isCivilDate(day.date) &&
      Array.isArray(day.transactions) &&
      day.transactions.every(isTransaction) &&
      Array.isArray(day.totals) &&
      day.totals.every(isTotal),
  );
}

export function shiftDate(
  date: string,
  period: Period,
  direction: -1 | 1,
): string {
  const [year, month, day] = date.split('-').map(Number);
  const current = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (period === 'month') {
    const target = new Date(
      Date.UTC(year ?? 0, (month ?? 1) - 1 + direction, 1),
    );
    const lastDay = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate();
    target.setUTCDate(Math.min(day ?? 1, lastDay));
    return target.toISOString().slice(0, 10);
  }
  current.setUTCDate(
    current.getUTCDate() + direction * (period === 'week' ? 7 : 1),
  );
  return current.toISOString().slice(0, 10);
}

export function formatMoney(
  amount: string,
  currencyCode: string,
  scale: number,
): string {
  const [whole, fraction = ''] = amount.split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${grouped}${scale > 0 ? `,${fraction.padEnd(scale, '0')}` : ''} ${currencyCode}`;
}
