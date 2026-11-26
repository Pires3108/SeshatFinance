import { Currency } from '../money/currency.js';
import { Money, type MoneySnapshot } from '../money/money.js';

export const budgetDimensionKinds = [
  'category',
  'cost-center',
  'account',
] as const;
export type BudgetDimensionKind = (typeof budgetDimensionKinds)[number];

export type BudgetDimension = Readonly<{
  kind: BudgetDimensionKind;
  id: string;
}>;

export const budgetLifecycles = ['active', 'archived'] as const;
export type BudgetLifecycle = (typeof budgetLifecycles)[number];

/** A civil month "YYYY-MM" in the holder's time zone (RII-012). */
export type BudgetMonth = string;

/** The limit in force from a civil month on, until the next version. */
export type BudgetLimitVersion = Readonly<{
  effectiveFrom: BudgetMonth;
  limit: MoneySnapshot;
}>;

export type BudgetSnapshot = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  dimension: BudgetDimension;
  currency: Readonly<{ code: string; minorUnitScale: number }>;
  limits: readonly BudgetLimitVersion[];
  lifecycle: BudgetLifecycle;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}>;

export class InvalidBudgetError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidBudgetError';
  }
}

export class BudgetLifecycleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'BudgetLifecycleError';
  }
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const MAX_NAME_LENGTH = 120;

export function isBudgetMonth(value: string): value is BudgetMonth {
  return MONTH.test(value);
}

/**
 * A monthly spending plan for one dimension (US-052, RF-072). It never
 * blocks, cancels or changes a transaction: going over the limit is only an
 * organizational warning. A limit change applies from a month on and keeps
 * the limits of earlier months, so past consumption is not rewritten.
 */
export class Budget {
  private constructor(private state: BudgetSnapshot) {}

  public static create(
    input: Readonly<{
      id: string;
      ownerId: string;
      name: string;
      dimension: BudgetDimension;
      limit: Money;
      effectiveFrom: BudgetMonth;
      createdAt: Date;
    }>,
  ): Budget {
    const createdAt = validDate(input.createdAt);
    return new Budget({
      createdAt,
      currency: {
        code: input.limit.currency.code,
        minorUnitScale: input.limit.currency.minorUnitScale,
      },
      dimension: validDimension(input.dimension),
      id: required(input.id, 'id'),
      lifecycle: 'active',
      limits: [version(input.limit, input.effectiveFrom)],
      name: validName(input.name),
      ownerId: required(input.ownerId, 'ownerId'),
      updatedAt: createdAt,
      version: 1,
    });
  }

  public static restore(snapshot: BudgetSnapshot): Budget {
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
      throw new InvalidBudgetError(
        'Budget version must be a positive integer.',
      );
    }
    if (!budgetLifecycles.includes(snapshot.lifecycle)) {
      throw new InvalidBudgetError('Unknown budget lifecycle.');
    }
    const currency = Currency.create(
      snapshot.currency.code,
      snapshot.currency.minorUnitScale,
    );
    if (snapshot.limits.length === 0) {
      throw new InvalidBudgetError('A budget needs a limit.');
    }
    const limits = snapshot.limits.map((item) => {
      const limit = Money.restore(item.limit);
      if (!limit.currency.equals(currency)) {
        throw new InvalidBudgetError('Every limit uses the budget currency.');
      }
      return version(limit, item.effectiveFrom);
    });
    for (let index = 1; index < limits.length; index += 1) {
      if (
        (limits[index - 1]?.effectiveFrom ?? '') >=
        (limits[index]?.effectiveFrom ?? '')
      ) {
        throw new InvalidBudgetError('Limit versions must be in month order.');
      }
    }
    return new Budget({
      ...snapshot,
      createdAt: validDate(snapshot.createdAt),
      dimension: validDimension(snapshot.dimension),
      limits,
      name: validName(snapshot.name),
      updatedAt: validDate(snapshot.updatedAt),
    });
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get name(): string {
    return this.state.name;
  }

  public get dimension(): BudgetDimension {
    return this.state.dimension;
  }

  public get currency(): Currency {
    return Currency.create(
      this.state.currency.code,
      this.state.currency.minorUnitScale,
    );
  }

  public get lifecycle(): BudgetLifecycle {
    return this.state.lifecycle;
  }

  public get version(): number {
    return this.state.version;
  }

  public get limits(): readonly Readonly<{
    effectiveFrom: BudgetMonth;
    limit: Money;
  }>[] {
    return this.state.limits.map((item) => ({
      effectiveFrom: item.effectiveFrom,
      limit: Money.restore(item.limit),
    }));
  }

  /** The limit in force in a month, or null before the budget starts. */
  public limitFor(month: BudgetMonth): Money | null {
    if (!isBudgetMonth(month)) throw new InvalidBudgetError('Invalid month.');
    let found: BudgetLimitVersion | null = null;
    for (const item of this.state.limits) {
      if (item.effectiveFrom <= month) found = item;
    }
    return found === null ? null : Money.restore(found.limit);
  }

  /**
   * Renames the budget and sets a new limit from `effectiveFrom` on. The
   * month cannot be before `currentMonth` (past months keep their limit),
   * nor before the last version; the same month replaces that version.
   */
  public change(
    input: Readonly<{
      name: string;
      limit: Money;
      effectiveFrom: BudgetMonth;
      currentMonth: BudgetMonth;
    }>,
    at: Date,
  ): void {
    if (this.state.lifecycle === 'archived') {
      throw new BudgetLifecycleError('An archived budget cannot be edited.');
    }
    if (!input.limit.currency.equals(this.currency)) {
      throw new InvalidBudgetError('The limit uses the budget currency.');
    }
    const next = version(input.limit, input.effectiveFrom);
    if (!isBudgetMonth(input.currentMonth)) {
      throw new InvalidBudgetError('Invalid month.');
    }
    if (next.effectiveFrom < input.currentMonth) {
      throw new InvalidBudgetError(
        'A limit change cannot apply to a past month.',
      );
    }
    const last = this.state.limits[this.state.limits.length - 1];
    if (last !== undefined && next.effectiveFrom < last.effectiveFrom) {
      throw new InvalidBudgetError(
        'A limit change cannot precede the last version.',
      );
    }
    const kept = this.state.limits.filter(
      (item) => item.effectiveFrom !== next.effectiveFrom,
    );
    this.touch(
      { ...this.state, limits: [...kept, next], name: validName(input.name) },
      at,
    );
  }

  public archive(at: Date): void {
    if (this.state.lifecycle === 'archived') {
      throw new BudgetLifecycleError('The budget is already archived.');
    }
    this.touch({ ...this.state, lifecycle: 'archived' }, at);
  }

  public unarchive(at: Date): void {
    if (this.state.lifecycle !== 'archived') {
      throw new BudgetLifecycleError(
        'Only an archived budget can be restored.',
      );
    }
    this.touch({ ...this.state, lifecycle: 'active' }, at);
  }

  public toSnapshot(): BudgetSnapshot {
    return {
      ...this.state,
      currency: { ...this.state.currency },
      dimension: { ...this.state.dimension },
      limits: this.state.limits.map((item) => ({
        effectiveFrom: item.effectiveFrom,
        limit: { ...item.limit },
      })),
    };
  }

  private touch(next: BudgetSnapshot, at: Date): void {
    const updatedAt = validDate(at);
    if (updatedAt.getTime() < this.state.updatedAt.getTime()) {
      throw new InvalidBudgetError(
        'A budget change cannot precede the last one.',
      );
    }
    this.state = { ...next, updatedAt, version: this.state.version + 1 };
  }
}

export type BudgetConsumption = Readonly<{
  planned: Money;
  realized: Money;
  /** What is left; zero when the limit is reached or passed. */
  remaining: Money;
  /** How much the realized passes the limit; zero otherwise. */
  excess: Money;
  /** Organizational warning only; nothing is ever blocked. */
  exceeded: boolean;
}>;

export function calculateBudgetConsumption(
  planned: Money,
  realized: Money,
): BudgetConsumption {
  const zero = Money.fromMinorUnits(0n, planned.currency);
  const difference = planned.subtract(realized);
  const exceeded = difference.compare(zero) < 0;
  return {
    excess: exceeded ? difference.negate() : zero,
    exceeded,
    planned,
    realized,
    remaining: exceeded ? zero : difference,
  };
}

function version(limit: Money, effectiveFrom: BudgetMonth): BudgetLimitVersion {
  if (!isBudgetMonth(effectiveFrom)) {
    throw new InvalidBudgetError('A limit starts in a valid month (YYYY-MM).');
  }
  if (limit.compare(Money.fromMinorUnits(0n, limit.currency)) <= 0) {
    throw new InvalidBudgetError('A budget limit must be positive.');
  }
  return { effectiveFrom, limit: limit.toSnapshot() };
}

function validDimension(dimension: BudgetDimension): BudgetDimension {
  if (!budgetDimensionKinds.includes(dimension.kind)) {
    throw new InvalidBudgetError('Unknown budget dimension.');
  }
  return {
    id: required(dimension.id, 'dimension').toLowerCase(),
    kind: dimension.kind,
  };
}

function validName(value: string): string {
  const name = required(value, 'name');
  if (name.length > MAX_NAME_LENGTH) {
    throw new InvalidBudgetError(
      'Budget name must have at most 120 characters.',
    );
  }
  return name;
}

function required(value: string, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    throw new InvalidBudgetError(`Budget ${field} is required.`);
  }
  return trimmed;
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidBudgetError('Budget instants must be valid dates.');
  }
  return new Date(value.getTime());
}

/** One entry of the month as the Transactions module reports it. */
export type BudgetEntry = Readonly<{
  id: string;
  kind: 'income' | 'expense';
  amount: Money;
  accountId: string;
  categoryId: string | null;
  subcategoryId: string | null;
  costCenterId: string | null;
  /** Card settlement, transfer side or balance adjustment: not spending. */
  notSpending: boolean;
  /** For a refund (income) or compensation (expense), its expense. */
  refundOfExpenseId: string | null;
}>;

export type BudgetRealized = Readonly<{
  realized: Money;
  /** Matching expenses counted in the period. */
  countedEntries: number;
  /** Matching expenses in another currency, left out (never converted). */
  otherCurrencyEntries: number;
}>;

/**
 * Realized amount of a budget for the entries of one period (US-052):
 * matching expenses, net of the refunds and compensations of those
 * expenses recorded in the same period. Currencies are never added.
 */
export function calculateBudgetRealized(
  budget: Budget,
  entries: readonly BudgetEntry[],
): BudgetRealized {
  const currency = budget.currency;
  const dimension = budget.dimension;
  const matches = (entry: BudgetEntry): boolean => {
    const values =
      dimension.kind === 'category'
        ? [entry.categoryId, entry.subcategoryId]
        : dimension.kind === 'cost-center'
          ? [entry.costCenterId]
          : [entry.accountId];
    return values.some(
      (value) => value !== null && value.toLowerCase() === dimension.id,
    );
  };
  let realized = Money.fromMinorUnits(0n, currency);
  let countedEntries = 0;
  let otherCurrencyEntries = 0;
  const counted = new Set<string>();
  for (const entry of entries) {
    if (
      entry.kind !== 'expense' ||
      entry.notSpending ||
      entry.refundOfExpenseId !== null ||
      !matches(entry)
    ) {
      continue;
    }
    if (!entry.amount.currency.equals(currency)) {
      otherCurrencyEntries += 1;
      continue;
    }
    realized = realized.add(entry.amount);
    countedEntries += 1;
    counted.add(entry.id.toLowerCase());
  }
  for (const entry of entries) {
    if (
      entry.refundOfExpenseId === null ||
      !counted.has(entry.refundOfExpenseId.toLowerCase()) ||
      !entry.amount.currency.equals(currency)
    ) {
      continue;
    }
    realized =
      entry.kind === 'income'
        ? realized.subtract(entry.amount)
        : realized.add(entry.amount);
  }
  const zero = Money.fromMinorUnits(0n, currency);
  return {
    countedEntries,
    otherCurrencyEntries,
    realized: realized.compare(zero) < 0 ? zero : realized,
  };
}
