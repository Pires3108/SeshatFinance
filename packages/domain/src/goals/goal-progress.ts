import type { CivilDate } from '../calendar/civil-date.js';
import type { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import type { Goal, GoalAccountShare } from './goal.js';

/** Lifecycle of a linked account, as exposed by the Accounts module. */
export type GoalAccountLifecycle = 'active' | 'archived' | 'trashed';

/**
 * What the goal needs to know about one linked account: its current
 * balance and the sum of every amount share declared on it by the holder's
 * non-archived goals, including this one.
 */
export type GoalAccountPosition = Readonly<{
  accountId: string;
  balance: Money;
  lifecycle: GoalAccountLifecycle;
  declaredAmountShares: Money;
}>;

/** A manual quote: one unit of `source` is worth `rate` units of `target`. */
export type PresentationQuote = Readonly<{
  id: string;
  sourceCurrencyCode: string;
  targetCurrencyCode: string;
  rate: string;
  source: string;
  effectiveAt: Date;
}>;

export type GoalConversion =
  | Readonly<{ status: 'same-currency' }>
  | Readonly<{
      status: 'available';
      amount: Money;
      quoteId: string;
      rate: string;
      inverted: boolean;
      source: string;
      effectiveAt: Date;
    }>
  | Readonly<{ status: 'unavailable'; reason: 'missing-quote' }>;

export type GoalAccountProgressLine = Readonly<{
  accountId: string;
  share: GoalAccountShare;
  /** Value counted for the goal, in the account currency (original). */
  counted: Money;
  /** The balance no longer covers every declared share on the account. */
  belowDeclaredShares: boolean;
  /** Trashed accounts count zero until restored. */
  excluded: boolean;
  conversion: GoalConversion;
}>;

export const goalStatuses = [
  'in-progress',
  'completed',
  'overdue',
  'indeterminate',
  'paused',
  'archived',
] as const;
export type GoalStatus = (typeof goalStatuses)[number];

export type GoalProgress = Readonly<{
  lines: readonly GoalAccountProgressLine[];
  /** Initial amount plus counted values, or null when a quote is missing. */
  accumulated: Money | null;
  remaining: Money | null;
  /** Percentage of the target with two decimals, truncated; may pass 100. */
  percent: string | null;
  status: GoalStatus;
}>;

export class GoalProgressInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'GoalProgressInputError';
  }
}

/**
 * Derives the progress of a goal (RF-049, RN-069, RN-070, INV-047). It is a
 * read model only: conversions are presentation values with their quote,
 * and nothing here changes a balance, a transaction or net worth.
 */
export function calculateGoalProgress(
  input: Readonly<{
    goal: Goal;
    positions: ReadonlyMap<string, GoalAccountPosition>;
    quotes: readonly PresentationQuote[];
    today: CivilDate;
    now: Date;
  }>,
): GoalProgress {
  const target = input.goal.target;
  const lines = input.goal.links.map((link) => {
    const position = input.positions.get(link.accountId);
    if (position === undefined) {
      throw new GoalProgressInputError(
        'Every linked account needs a position.',
      );
    }
    const counted = countedValue(link.share, position);
    return {
      accountId: link.accountId,
      belowDeclaredShares: counted.belowDeclaredShares,
      conversion: convert(
        counted.value,
        target.currency,
        input.quotes,
        input.now,
      ),
      counted: counted.value,
      excluded: position.lifecycle === 'trashed',
      share: link.share,
    };
  });

  let accumulated: Money | null = input.goal.initialAmount;
  for (const line of lines) {
    if (accumulated === null) break;
    if (line.conversion.status === 'unavailable') accumulated = null;
    else if (line.conversion.status === 'available')
      accumulated = accumulated.add(line.conversion.amount);
    else accumulated = accumulated.add(line.counted);
  }

  return {
    accumulated,
    lines,
    percent: accumulated === null ? null : percentOf(accumulated, target),
    remaining: accumulated === null ? null : remainingOf(accumulated, target),
    status: statusOf(input.goal, accumulated, input.today),
  };
}

function countedValue(
  share: GoalAccountShare,
  position: GoalAccountPosition,
): Readonly<{ value: Money; belowDeclaredShares: boolean }> {
  const zero = Money.fromMinorUnits(0n, position.balance.currency);
  if (position.lifecycle === 'trashed') {
    return { belowDeclaredShares: false, value: zero };
  }
  const available =
    position.balance.compare(zero) > 0 ? position.balance : zero;
  if (share.kind === 'full') {
    return { belowDeclaredShares: false, value: available };
  }
  if (!share.amount.currency.equals(position.balance.currency)) {
    throw new GoalProgressInputError(
      'An account share must use the account currency.',
    );
  }
  const declared = position.declaredAmountShares;
  if (declared.compare(share.amount) < 0) {
    throw new GoalProgressInputError(
      'Declared shares must include this share.',
    );
  }
  if (available.compare(declared) >= 0) {
    return { belowDeclaredShares: false, value: share.amount };
  }
  // RN-069: every share keeps its proportion of what is left, truncated.
  const minor =
    (share.amount.toMinorUnits() * available.toMinorUnits()) /
    declared.toMinorUnits();
  return {
    belowDeclaredShares: true,
    value: Money.fromMinorUnits(minor, position.balance.currency),
  };
}

function convert(
  amount: Money,
  currency: Currency,
  quotes: readonly PresentationQuote[],
  now: Date,
): GoalConversion {
  if (amount.currency.equals(currency)) return { status: 'same-currency' };
  const from = amount.currency.code;
  const to = currency.code;
  let chosen: Readonly<{ quote: PresentationQuote; inverted: boolean }> | null =
    null;
  for (const quote of quotes) {
    if (quote.effectiveAt.getTime() > now.getTime()) continue;
    const direct =
      quote.sourceCurrencyCode === from && quote.targetCurrencyCode === to;
    const inverse =
      quote.sourceCurrencyCode === to && quote.targetCurrencyCode === from;
    if (!direct && !inverse) continue;
    const newer =
      chosen === null ||
      quote.effectiveAt.getTime() > chosen.quote.effectiveAt.getTime() ||
      (quote.effectiveAt.getTime() === chosen.quote.effectiveAt.getTime() &&
        direct &&
        chosen.inverted);
    if (newer) chosen = { inverted: inverse, quote };
  }
  if (chosen === null)
    return { reason: 'missing-quote', status: 'unavailable' };

  const rate = parseRate(chosen.quote.rate);
  const [numerator, denominator] = chosen.inverted
    ? [rate.denominator, rate.numerator]
    : [rate.numerator, rate.denominator];
  const scaleUp = 10n ** BigInt(currency.minorUnitScale);
  const scaleDown = 10n ** BigInt(amount.currency.minorUnitScale);
  const minor = divideHalfUp(
    amount.toMinorUnits() * numerator * scaleUp,
    denominator * scaleDown,
  );
  return {
    amount: Money.fromMinorUnits(minor, currency),
    effectiveAt: new Date(chosen.quote.effectiveAt.getTime()),
    inverted: chosen.inverted,
    quoteId: chosen.quote.id,
    rate: chosen.quote.rate,
    source: chosen.quote.source,
    status: 'available',
  };
}

function statusOf(
  goal: Goal,
  accumulated: Money | null,
  today: CivilDate,
): GoalStatus {
  if (goal.lifecycle === 'archived') return 'archived';
  if (goal.lifecycle === 'paused') return 'paused';
  if (accumulated === null) return 'indeterminate';
  if (accumulated.compare(goal.target) >= 0) return 'completed';
  const deadline = goal.deadline;
  if (deadline !== null && today.compare(deadline) > 0) return 'overdue';
  return 'in-progress';
}

function remainingOf(accumulated: Money, target: Money): Money {
  const remaining = target.subtract(accumulated);
  return remaining.compare(Money.fromMinorUnits(0n, target.currency)) > 0
    ? remaining
    : Money.fromMinorUnits(0n, target.currency);
}

function percentOf(accumulated: Money, target: Money): string {
  const basisPoints =
    (accumulated.toMinorUnits() * 10_000n) / target.toMinorUnits();
  const whole = basisPoints / 100n;
  const fraction = (basisPoints % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${fraction}`;
}

function parseRate(
  rate: string,
): Readonly<{ numerator: bigint; denominator: bigint }> {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(rate);
  if (match === null) {
    throw new GoalProgressInputError('Quote rate must be a plain decimal.');
  }
  const fraction = match[2] ?? '';
  const numerator = BigInt(`${match[1] ?? '0'}${fraction}`);
  if (numerator === 0n) {
    throw new GoalProgressInputError('Quote rate must be positive.');
  }
  return { denominator: 10n ** BigInt(fraction.length), numerator };
}

/** Integer division rounding half away from zero (HALF_UP, ADR-042). */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n * 2n + d) / (2n * d);
  return negative ? -quotient : quotient;
}
