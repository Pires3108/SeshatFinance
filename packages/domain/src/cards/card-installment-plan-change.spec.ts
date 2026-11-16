import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { calculateInstallmentPlan } from '../installments/installment-plan.js';
import { Currency } from '../money/currency.js';
import { Money, type MoneySnapshot } from '../money/money.js';
import {
  CardPlanClosedError,
  CardPlanPrepaymentMismatchError,
  CardPlanWithoutFutureInstallmentsError,
  deriveCardPlanState,
  InvalidCardPlanChangeError,
  type CardPlanChange,
  type CardPlanPrepayment,
} from './card-installment-plan-change.js';
import { CardInstallmentPlan } from './card-installment-plan.js';

const brl = Currency.create('BRL', 2);
const amount = (value: string): MoneySnapshot =>
  Money.fromDecimal(value, brl).toSnapshot();
const recordedAt = new Date('2026-12-10T12:00:00.000Z');
const plan = CardInstallmentPlan.create({
  cardId: 'card-id',
  createdAt: new Date('2026-11-16T12:00:00.000Z'),
  cycles: ['2026-11-28', '2026-12-28', '2027-01-28'].map((value) =>
    CivilDate.parse(value),
  ),
  id: 'plan-id',
  installmentIds: ['i-1', 'i-2', 'i-3'],
  ownerId: 'owner-id',
  plan: calculateInstallmentPlan({
    count: 3,
    principal: Money.fromDecimal('100.00', brl),
    rate: null,
  }),
  purchaseId: 'purchase-id',
});
const december = CivilDate.parse('2026-12-28');
const prepayment = (paid: string, discount: string): CardPlanPrepayment => ({
  amount: amount(paid),
  discount: amount(discount),
  effectiveCycleClosesOn: '2026-11-28',
  id: 'c1',
  kind: 'prepayment',
  recordedAt,
});

describe('deriveCardPlanState (US-046)', () => {
  it('separates invoiced facts from projected installments', () => {
    const state = deriveCardPlanState(plan, [], CivilDate.parse('2026-11-28'));

    expect(state.installments.map((item) => item.situation)).toEqual([
      'invoiced',
      'projected',
      'projected',
    ]);
    expect(state.futureOutstanding.toDecimal()).toBe('66.67');
    expect(state.status).toBe('active');
  });

  it('keeps the original schedule visible as prepaid after an early settlement', () => {
    const state = deriveCardPlanState(
      plan,
      [prepayment('60.00', '6.67')],
      december,
    );

    expect(state.status).toBe('prepaid');
    expect(state.installments.map((item) => item.situation)).toEqual([
      'invoiced',
      'prepaid',
      'prepaid',
    ]);
    expect(state.futureOutstanding.toDecimal()).toBe('0.00');
    expect(() =>
      deriveCardPlanState(plan, [prepayment('60.00', '0.00')], december),
    ).toThrow(CardPlanPrepaymentMismatchError);
  });

  it('marks the future installments as renegotiated and closes the plan', () => {
    const renegotiation: CardPlanChange = {
      effectiveCycleClosesOn: '2026-11-28',
      id: 'c1',
      kind: 'renegotiation',
      newPlanId: 'plan-2',
      recordedAt,
    };
    const state = deriveCardPlanState(plan, [renegotiation], december);

    expect(state.status).toBe('renegotiated');
    expect(state.installments.map((item) => item.situation)).toEqual([
      'invoiced',
      'renegotiated',
      'renegotiated',
    ]);
    expect(() =>
      deriveCardPlanState(
        plan,
        [renegotiation, { ...prepayment('66.67', '0'), id: 'c2' }],
        december,
      ),
    ).toThrow(CardPlanClosedError);
  });

  it('restores the plan after an auditable reversal of the prepayment', () => {
    const state = deriveCardPlanState(
      plan,
      [
        prepayment('66.67', '0.00'),
        {
          id: 'r1',
          kind: 'reversal',
          reason: 'Antecipação lançada por engano',
          recordedAt,
          reversedChangeId: 'c1',
        },
      ],
      CivilDate.parse('2026-11-28'),
    );

    expect(state.status).toBe('active');
    expect(state.reversedChangeIds).toEqual(['c1']);
    expect(state.futureOutstanding.toDecimal()).toBe('66.67');
  });

  it('refuses a change with no future installment', () => {
    expect(() =>
      deriveCardPlanState(
        plan,
        [
          {
            ...prepayment('0.00', '0.00'),
            effectiveCycleClosesOn: '2027-01-28',
          },
        ],
        CivilDate.parse('2027-01-28'),
      ),
    ).toThrow(CardPlanWithoutFutureInstallmentsError);
  });

  it.each([
    [
      'reversal of a renegotiation',
      [
        {
          effectiveCycleClosesOn: '2026-11-28',
          id: 'c1',
          kind: 'renegotiation',
          newPlanId: 'p2',
          recordedAt,
        },
        {
          id: 'r1',
          kind: 'reversal',
          reason: 'x',
          recordedAt,
          reversedChangeId: 'c1',
        },
      ],
    ],
    [
      'reversal without reason',
      [
        prepayment('66.67', '0.00'),
        {
          id: 'r1',
          kind: 'reversal',
          reason: ' ',
          recordedAt,
          reversedChangeId: 'c1',
        },
      ],
    ],
    [
      'prepayment in another currency',
      [
        {
          ...prepayment('66.67', '0.00'),
          amount: Money.fromDecimal(
            '66.67',
            Currency.create('USD', 2),
          ).toSnapshot(),
        },
      ],
    ],
  ] as const)('rejects %s', (_label, changes) => {
    expect(() =>
      deriveCardPlanState(plan, changes as readonly CardPlanChange[], december),
    ).toThrow(InvalidCardPlanChangeError);
  });
});
