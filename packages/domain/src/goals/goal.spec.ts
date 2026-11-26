import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { Goal, GoalLifecycleError, InvalidGoalError } from './goal.js';

const brl = Currency.create('BRL', 2);
const usd = Currency.create('USD', 2);
const created = new Date('2026-11-20T12:00:00.000Z');
const later = new Date('2026-11-21T12:00:00.000Z');

const free = {
  createdAt: created,
  deadline: CivilDate.parse('2026-12-31'),
  id: 'goal-id',
  initialAmount: null,
  links: [],
  mode: 'free' as const,
  name: '  Viagem  ',
  ownerId: 'owner-id',
  target: Money.fromDecimal('500.00', brl),
};

describe('Goal', () => {
  it('creates a free goal without accounts, with target and deadline', () => {
    const snapshot = Goal.create(free).toSnapshot();

    expect(snapshot).toMatchObject({
      deadline: '2026-12-31',
      initialAmount: { amount: '0.00' },
      lifecycle: 'active',
      links: [],
      mode: 'free',
      name: 'Viagem',
      target: { amount: '500.00', currency: { code: 'BRL' } },
      version: 1,
    });
  });

  it('accepts an account in another currency with an amount share', () => {
    const goal = Goal.create({
      ...free,
      links: [
        {
          accountId: 'ACCOUNT-1',
          share: { amount: Money.fromDecimal('50.00', usd), kind: 'amount' },
        },
      ],
      mode: 'linked',
    });

    expect(goal.links).toHaveLength(1);
    expect(goal.links[0]?.accountId).toBe('account-1');
  });

  it.each([
    ['target zero', { target: Money.fromDecimal('0.00', brl) }],
    [
      'initial in another currency',
      { initialAmount: Money.fromDecimal('1.00', usd) },
    ],
    ['negative initial', { initialAmount: Money.fromDecimal('-1.00', brl) }],
    ['blank name', { name: '   ' }],
    ['long name', { name: 'x'.repeat(121) }],
    [
      'free goal with account',
      { links: [{ accountId: 'a', share: { kind: 'full' as const } }] },
    ],
    ['linked goal without account', { mode: 'linked' as const }],
    [
      'repeated account',
      {
        links: [
          { accountId: 'a', share: { kind: 'full' as const } },
          { accountId: 'A', share: { kind: 'full' as const } },
        ],
        mode: 'linked' as const,
      },
    ],
    [
      'zero share',
      {
        links: [
          {
            accountId: 'a',
            share: {
              amount: Money.fromDecimal('0.00', brl),
              kind: 'amount' as const,
            },
          },
        ],
        mode: 'linked' as const,
      },
    ],
  ])('rejects %s', (_label, override) => {
    expect(() => Goal.create({ ...free, ...override })).toThrow(
      InvalidGoalError,
    );
  });

  it('pauses, resumes, archives and unarchives with versions', () => {
    const goal = Goal.create(free);
    goal.pause(later);
    goal.resume(later);
    goal.archive(later);

    expect(() => {
      goal.update(free, later);
    }).toThrow(GoalLifecycleError);
    goal.unarchive(later);
    expect(goal.lifecycle).toBe('active');
    expect(goal.version).toBe(5);
    expect(() => {
      goal.resume(later);
    }).toThrow(GoalLifecycleError);
  });

  it('turns into a free goal when the last account is unlinked', () => {
    const goal = Goal.create({
      ...free,
      links: [{ accountId: 'a', share: { kind: 'full' } }],
      mode: 'linked',
    });
    goal.unlinkAccount('a', later);

    expect(goal.toSnapshot()).toMatchObject({ links: [], mode: 'free' });
    expect(() => {
      goal.unlinkAccount('a', later);
    }).toThrow(InvalidGoalError);
  });

  it('restores its snapshot and refuses changes back in time', () => {
    const goal = Goal.restore(Goal.create(free).toSnapshot());

    expect(goal.toSnapshot()).toEqual(Goal.create(free).toSnapshot());
    expect(() => {
      goal.pause(new Date('2026-11-19T12:00:00.000Z'));
    }).toThrow(InvalidGoalError);
  });
});
