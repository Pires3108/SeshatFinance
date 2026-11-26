import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { Goal, type GoalAccountLink } from './goal.js';
import {
  calculateGoalProgress,
  type GoalAccountPosition,
  type PresentationQuote,
} from './goal-progress.js';

const brl = Currency.create('BRL', 2);
const usd = Currency.create('USD', 2);
const now = new Date('2026-11-20T15:00:00.000Z');
const today = CivilDate.parse('2026-11-20');

function goal(
  links: readonly GoalAccountLink[],
  extra: Partial<{ deadline: CivilDate | null; initial: string }> = {},
): Goal {
  return Goal.create({
    createdAt: new Date('2026-11-01T12:00:00.000Z'),
    deadline: extra.deadline ?? null,
    id: 'goal-id',
    initialAmount:
      extra.initial === undefined
        ? null
        : Money.fromDecimal(extra.initial, brl),
    links,
    mode: links.length === 0 ? 'free' : 'linked',
    name: 'Reserva',
    ownerId: 'owner-id',
    target: Money.fromDecimal('500.00', brl),
  });
}

function position(
  accountId: string,
  balance: Money,
  declared: Money = Money.fromMinorUnits(0n, balance.currency),
  lifecycle: GoalAccountPosition['lifecycle'] = 'active',
): [string, GoalAccountPosition] {
  return [
    accountId,
    { accountId, balance, declaredAmountShares: declared, lifecycle },
  ];
}

const quote = (
  overrides: Partial<PresentationQuote> = {},
): PresentationQuote => ({
  effectiveAt: new Date('2026-11-19T12:00:00.000Z'),
  id: 'quote-id',
  rate: '5.4321',
  source: 'Banco',
  sourceCurrencyCode: 'USD',
  targetCurrencyCode: 'BRL',
  ...overrides,
});

describe('calculateGoalProgress', () => {
  it('shows a free goal with its initial amount, remaining and percent', () => {
    const progress = calculateGoalProgress({
      goal: goal([], { initial: '125.00' }),
      now,
      positions: new Map(),
      quotes: [],
      today,
    });

    expect(progress.accumulated?.toDecimal()).toBe('125.00');
    expect(progress.remaining?.toDecimal()).toBe('375.00');
    expect(progress.percent).toBe('25.00');
    expect(progress.status).toBe('in-progress');
  });

  it('keeps the USD value and marks BRL as unavailable without a quote, never zero', () => {
    const progress = calculateGoalProgress({
      goal: goal([{ accountId: 'usd', share: { kind: 'full' } }]),
      now,
      positions: new Map([position('usd', Money.fromDecimal('80.00', usd))]),
      quotes: [quote({ effectiveAt: new Date('2026-11-21T00:00:00.000Z') })],
      today,
    });

    expect(progress.lines[0]?.counted.toDecimal()).toBe('80.00');
    expect(progress.lines[0]?.conversion).toEqual({
      reason: 'missing-quote',
      status: 'unavailable',
    });
    expect(progress.accumulated).toBeNull();
    expect(progress.percent).toBeNull();
    expect(progress.status).toBe('indeterminate');
  });

  it('converts with the latest effective quote, HALF_UP, keeping provenance', () => {
    const progress = calculateGoalProgress({
      goal: goal([{ accountId: 'usd', share: { kind: 'full' } }]),
      now,
      positions: new Map([position('usd', Money.fromDecimal('10.01', usd))]),
      quotes: [
        quote({ effectiveAt: new Date('2026-11-01T00:00:00.000Z'), rate: '1' }),
        quote({ id: 'latest' }),
      ],
      today,
    });

    // 10.01 × 5.4321 = 54.375321 → 54.38
    expect(progress.lines[0]?.conversion).toMatchObject({
      inverted: false,
      quoteId: 'latest',
      rate: '5.4321',
      source: 'Banco',
      status: 'available',
    });
    expect(progress.accumulated?.toDecimal()).toBe('54.38');
  });

  it('uses an inverse quote when only the opposite pair exists', () => {
    const progress = calculateGoalProgress({
      goal: goal([{ accountId: 'usd', share: { kind: 'full' } }]),
      now,
      positions: new Map([position('usd', Money.fromDecimal('10.00', usd))]),
      quotes: [
        quote({
          rate: '0.2',
          sourceCurrencyCode: 'BRL',
          targetCurrencyCode: 'USD',
        }),
      ],
      today,
    });

    expect(progress.accumulated?.toDecimal()).toBe('50.00');
    expect(progress.lines[0]?.conversion).toMatchObject({ inverted: true });
  });

  it('caps amount shares proportionally when the balance drops below them', () => {
    const shares = Money.fromDecimal('300.00', brl);
    const progress = calculateGoalProgress({
      goal: goal([
        {
          accountId: 'a',
          share: { amount: Money.fromDecimal('100.00', brl), kind: 'amount' },
        },
      ]),
      now,
      positions: new Map([
        position('a', Money.fromDecimal('200.00', brl), shares),
      ]),
      quotes: [],
      today,
    });

    // 100 × 200 / 300 = 66.666… → 66.66 (truncated)
    expect(progress.lines[0]).toMatchObject({ belowDeclaredShares: true });
    expect(progress.lines[0]?.counted.toDecimal()).toBe('66.66');
  });

  it('counts the declared share when the balance covers every share', () => {
    const progress = calculateGoalProgress({
      goal: goal([
        {
          accountId: 'a',
          share: { amount: Money.fromDecimal('100.00', brl), kind: 'amount' },
        },
      ]),
      now,
      positions: new Map([
        position(
          'a',
          Money.fromDecimal('300.00', brl),
          Money.fromDecimal('300.00', brl),
        ),
      ]),
      quotes: [],
      today,
    });

    expect(progress.lines[0]?.counted.toDecimal()).toBe('100.00');
    expect(progress.lines[0]?.belowDeclaredShares).toBe(false);
  });

  it('counts zero for a negative balance and for a trashed account', () => {
    const progress = calculateGoalProgress({
      goal: goal([
        { accountId: 'neg', share: { kind: 'full' } },
        { accountId: 'trash', share: { kind: 'full' } },
      ]),
      now,
      positions: new Map([
        position('neg', Money.fromDecimal('-10.00', brl)),
        position(
          'trash',
          Money.fromDecimal('90.00', brl),
          undefined,
          'trashed',
        ),
      ]),
      quotes: [],
      today,
    });

    expect(progress.lines.map((line) => line.counted.toDecimal())).toEqual([
      '0.00',
      '0.00',
    ]);
    expect(progress.lines[1]?.excluded).toBe(true);
  });

  it('is completed at the target, overdue only from the day after the deadline', () => {
    const deadline = CivilDate.parse('2026-11-20');
    const base = { now, positions: new Map(), quotes: [] };

    expect(
      calculateGoalProgress({
        ...base,
        goal: goal([], { deadline, initial: '100.00' }),
        today,
      }).status,
    ).toBe('in-progress');
    expect(
      calculateGoalProgress({
        ...base,
        goal: goal([], { deadline, initial: '100.00' }),
        today: CivilDate.parse('2026-11-21'),
      }).status,
    ).toBe('overdue');
    const done = calculateGoalProgress({
      ...base,
      goal: goal([], { deadline, initial: '600.00' }),
      today: CivilDate.parse('2026-11-21'),
    });
    expect(done.status).toBe('completed');
    expect(done.remaining?.toDecimal()).toBe('0.00');
    expect(done.percent).toBe('120.00');
  });

  it('lets paused and archived lifecycles prevail over the computed status', () => {
    const paused = goal([], { initial: '600.00' });
    paused.pause(now);
    const archived = goal([]);
    archived.archive(now);
    const base = { now, positions: new Map(), quotes: [], today };

    expect(calculateGoalProgress({ ...base, goal: paused }).status).toBe(
      'paused',
    );
    expect(calculateGoalProgress({ ...base, goal: archived }).status).toBe(
      'archived',
    );
  });
});
