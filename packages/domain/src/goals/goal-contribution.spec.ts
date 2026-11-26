import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { Goal } from './goal.js';
import {
  ContributionDistribution,
  ContributionExceedsSourceError,
  InvalidContributionError,
} from './goal-contribution.js';
import {
  calculateGoalProgress,
  type GoalContributionPosition,
} from './goal-progress.js';

const brl = Currency.create('BRL', 2);
const usd = Currency.create('USD', 2);
const money = (amount: string): Money => Money.fromDecimal(amount, brl);
const at = new Date('2026-11-26T12:00:00.000Z');
const later = new Date('2026-11-27T12:00:00.000Z');

function distribute(
  lines: readonly [string, string][],
  source = '100.00',
): ContributionDistribution {
  return ContributionDistribution.create({
    at,
    authorId: 'owner',
    lines: lines.map(([goalId, amount]) => ({ amount: money(amount), goalId })),
    ownerId: 'owner',
    source: money(source),
    sourceTransactionId: 'ENTRY-1',
  });
}

function goal(
  links: readonly string[] = [],
  target = '500.00',
  currency = brl,
): Goal {
  return Goal.create({
    createdAt: at,
    deadline: null,
    id: 'goal-a',
    initialAmount: null,
    links: links.map((accountId) => ({ accountId, share: { kind: 'full' } })),
    mode: links.length === 0 ? 'free' : 'linked',
    name: 'Meta',
    ownerId: 'owner',
    target: Money.fromDecimal(target, currency),
  });
}

function position(
  change: Partial<GoalContributionPosition> = {},
): GoalContributionPosition {
  return {
    accountId: 'account-1',
    allocatedTotal: money('100.00'),
    amount: money('60.00'),
    sourceAmount: money('100.00'),
    sourceLifecycle: 'active',
    sourceTransactionId: 'entry-1',
    ...change,
  };
}

const progress = (
  target: Goal,
  contributions: readonly GoalContributionPosition[],
): ReturnType<typeof calculateGoalProgress> =>
  calculateGoalProgress({
    contributions,
    goal: target,
    now: at,
    positions: new Map(
      target.links.map((link) => [
        link.accountId,
        {
          accountId: link.accountId,
          balance: money('100.00'),
          declaredAmountShares: money('0.00'),
          lifecycle: 'active' as const,
        },
      ]),
    ),
    quotes: [],
    today: CivilDate.parse('2026-11-26'),
  });

describe('ContributionDistribution (US-050, INV-025)', () => {
  it('splits 100 into 60 and 40 within the source', () => {
    const distribution = distribute([
      ['GOAL-A', '60.00'],
      ['goal-b', '40.00'],
    ]);

    expect(distribution.sourceTransactionId).toBe('entry-1');
    expect(distribution.lines.map((l) => l.goalId)).toEqual([
      'goal-a',
      'goal-b',
    ]);
    expect(distribution.allocated?.toDecimal()).toBe('100.00');
  });

  it('refuses 70 + 40 over a 100 source as a whole', () => {
    expect(() =>
      distribute([
        ['goal-a', '70.00'],
        ['goal-b', '40.00'],
      ]),
    ).toThrow(ContributionExceedsSourceError);
    const distribution = distribute([['goal-a', '70.00']]);
    expect(() => {
      distribution.replace(
        [
          { amount: money('70.00'), goalId: 'goal-a' },
          { amount: money('40.00'), goalId: 'goal-b' },
        ],
        money('100.00'),
        'owner',
        later,
      );
    }).toThrow(ContributionExceedsSourceError);
    expect(distribution.version).toBe(1);
  });

  it('corrects and removes the lines with a new version', () => {
    const distribution = distribute([['goal-a', '70.00']]);
    distribution.replace([], money('100.00'), 'owner', later);

    expect(distribution.lines).toEqual([]);
    expect(distribution.allocated).toBeNull();
    expect(distribution.version).toBe(2);
  });

  it.each([
    [
      'a repeated goal',
      [
        ['a', '1.00'],
        ['A', '1.00'],
      ] as [string, string][],
    ],
    ['a zero line', [['a', '0.00']] as [string, string][]],
  ])('rejects %s', (_label, lines) => {
    expect(() => distribute(lines)).toThrow(InvalidContributionError);
  });

  it('rejects another currency and a non-positive source', () => {
    expect(() =>
      ContributionDistribution.create({
        at,
        authorId: 'owner',
        lines: [{ amount: Money.fromDecimal('1.00', usd), goalId: 'a' }],
        ownerId: 'owner',
        source: money('100.00'),
        sourceTransactionId: 'entry',
      }),
    ).toThrow(InvalidContributionError);
    expect(() => distribute([], '0.00')).toThrow(InvalidContributionError);
  });
});

describe('goal progress with contributions (US-050, INV-026)', () => {
  it('adds a declared contribution to the accumulated value', () => {
    const result = progress(goal(), [position()]);

    expect(result.accumulated?.toDecimal()).toBe('60.00');
    expect(result.percent).toBe('12.00');
    expect(result.contributions[0]).toMatchObject({
      coveredByAccount: false,
      excluded: false,
    });
  });

  it('counts a trashed entry as zero and keeps the historical line', () => {
    const result = progress(goal(), [position({ sourceLifecycle: 'trashed' })]);

    expect(result.accumulated?.toDecimal()).toBe('0.00');
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]?.excluded).toBe(true);
  });

  it('does not count twice an entry made in a linked account', () => {
    const result = progress(goal(['account-1']), [position()]);

    expect(result.accumulated?.toDecimal()).toBe('100.00');
    expect(result.contributions[0]?.coveredByAccount).toBe(true);
  });

  it('keeps proportions when the entry is edited below its lines', () => {
    const result = progress(goal(), [
      position({ sourceAmount: money('50.00') }),
    ]);

    expect(result.contributions[0]?.counted.toDecimal()).toBe('30.00');
    expect(result.contributions[0]?.belowDeclared).toBe(true);
  });

  it('marks progress unavailable for a foreign contribution without quote', () => {
    const result = progress(goal([], '500.00', usd), [position()]);

    expect(result.accumulated).toBeNull();
    expect(result.status).toBe('indeterminate');
    expect(result.contributions[0]?.conversion.status).toBe('unavailable');
  });
});
