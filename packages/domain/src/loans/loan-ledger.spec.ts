import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import { Money, type MoneySnapshot } from '../money/money.js';
import { Loan, type CreateLoanProperties } from './loan.js';
import {
  deriveLoanState,
  InvalidLoanEventError,
  LoanClosedError,
  LoanExcessBeyondContractError,
  LoanPaymentExcessUnclassifiedError,
  LoanPrepaymentMismatchError,
  type LoanEvent,
  type LoanPaymentEvent,
} from './loan-ledger.js';

const brl = Currency.create('BRL', 2);
const amount = (value: string): MoneySnapshot =>
  Money.fromDecimal(value, brl).toSnapshot();
const date = (value: string): CivilDate => CivilDate.parse(value);
const recordedAt = new Date('2026-11-16T12:00:00.000Z');

function loan(change: Partial<CreateLoanProperties> = {}): Loan {
  return Loan.create({
    businessDayRule: 'none',
    contractedOn: date('2026-01-10'),
    count: 1,
    createdAt: recordedAt,
    description: 'Empréstimo ao Pedro',
    direction: 'receivable',
    firstDueOn: date('2026-02-10'),
    id: 'loan-id',
    isHoliday: () => false,
    ownerId: 'owner-id',
    principal: Money.fromDecimal('100.00', brl),
    profile: 'constant',
    rate: null,
    ...change,
  });
}

function payment(
  id: string,
  occurredOn: string,
  value: string,
  change: Partial<LoanPaymentEvent> = {},
): LoanPaymentEvent {
  return {
    allocationOrder: null,
    amount: amount(value),
    declaredFee: null,
    excess: null,
    id,
    kind: 'payment',
    occurredOn,
    recordedAt,
    ...change,
  };
}

describe('deriveLoanState (US-047, INV-048)', () => {
  it('keeps the remaining balance after a partial payment', () => {
    const state = deriveLoanState(
      loan(),
      [payment('p1', '2026-02-10', '40.00')],
      date('2026-02-10'),
    );

    expect(state.pending.toDecimal()).toBe('60.00');
    expect(state.status).toBe('active');
    expect(state.installments[0]?.situation).toBe('partial');
  });

  it('starts the delay the day after the effective due date and fixes the fee once', () => {
    const subject = loan({ lateFeePercent: '2' });

    expect(
      deriveLoanState(subject, [], date('2026-02-10')).installments[0]
        ?.situation,
    ).toBe('open');
    const late = deriveLoanState(subject, [], date('2026-02-11'));
    expect(late.installments[0]).toMatchObject({ situation: 'overdue' });
    expect(late.installments[0]?.estimatedFee?.toDecimal()).toBe('2.00');
    expect(late.pending.toDecimal()).toBe('102.00');
    expect(
      deriveLoanState(subject, [], date('2026-06-30')).pending.toDecimal(),
    ).toBe('102.00');
  });

  it('moves the due date to the next business day under the general rule', () => {
    const subject = loan({
      businessDayRule: 'next-business-day',
      // 2026-02-14 is a Saturday.
      firstDueOn: date('2026-02-14'),
    });

    expect(subject.installments[0]).toMatchObject({
      dueOn: '2026-02-16',
      scheduledDueOn: '2026-02-14',
    });
    expect(
      deriveLoanState(subject, [], date('2026-02-16')).installments[0]
        ?.situation,
    ).toBe('open');
  });

  it('keeps the configured day in short months', () => {
    const subject = loan({
      count: 3,
      firstDueOn: date('2026-01-31'),
    });

    expect(subject.installments.map((item) => item.scheduledDueOn)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('allocates fee, interest and principal of the oldest overdue installment first', () => {
    const subject = loan({ count: 2, lateFeePercent: '10' });
    const state = deriveLoanState(
      subject,
      [payment('p1', '2026-03-12', '55.00')],
      date('2026-03-12'),
    );

    // Installment 1 (50.00) is overdue since 10/02 with a 5.00 fee.
    expect(state.installments[0]).toMatchObject({ situation: 'paid' });
    expect(state.installments[1]).toMatchObject({ situation: 'overdue' });
    expect(state.pending.toDecimal()).toBe('55.00');
  });

  it('lets the declared fee prevail over the estimate without erasing it', () => {
    const state = deriveLoanState(
      loan({ lateFeePercent: '10' }),
      [
        payment('p1', '2026-03-01', '50.00', {
          declaredFee: amount('3.00'),
        }),
      ],
      date('2026-03-01'),
    );

    expect(state.installments[0]?.estimatedFee?.toDecimal()).toBe('10.00');
    expect(state.installments[0]?.declaredFee?.toDecimal()).toBe('3.00');
    expect(state.pending.toDecimal()).toBe('53.00');
  });

  it('refuses an unclassified excess over the eligible obligation', () => {
    expect(() =>
      deriveLoanState(
        loan({ count: 2 }),
        [payment('p1', '2026-02-10', '60.00')],
        date('2026-02-10'),
      ),
    ).toThrow(LoanPaymentExcessUnclassifiedError);
  });

  it('applies a classified extra amortization to the next installments', () => {
    const state = deriveLoanState(
      loan({ count: 2 }),
      [payment('p1', '2026-02-10', '60.00', { excess: 'extra-amortization' })],
      date('2026-02-10'),
    );

    expect(state.pending.toDecimal()).toBe('40.00');
    expect(state.installments[1]?.situation).toBe('partial');
  });

  it('records a receivable credit and allows a negative organizational balance', () => {
    const state = deriveLoanState(
      loan(),
      [payment('p1', '2026-02-10', '130.00', { excess: 'receivable-credit' })],
      date('2026-02-10'),
    );

    expect(state.credit.toDecimal()).toBe('30.00');
    expect(state.pending.toDecimal()).toBe('-30.00');
    expect(() =>
      deriveLoanState(
        loan(),
        [
          payment('p1', '2026-02-10', '130.00', {
            excess: 'extra-amortization',
          }),
        ],
        date('2026-02-10'),
      ),
    ).toThrow(LoanExcessBeyondContractError);
  });

  it('keeps future installments visible as prepaid after an early settlement', () => {
    const subject = loan({ count: 3 });
    const state = deriveLoanState(
      subject,
      [
        payment('p1', '2026-02-10', '33.33'),
        {
          amount: amount('60.00'),
          discount: amount('6.67'),
          id: 'q1',
          kind: 'prepayment',
          occurredOn: '2026-02-20',
          recordedAt,
        },
      ],
      date('2026-03-01'),
    );

    expect(state.status).toBe('settled');
    expect(state.pending.toDecimal()).toBe('0.00');
    expect(state.installments.map((item) => item.situation)).toEqual([
      'paid',
      'prepaid',
      'prepaid',
    ]);
    expect(subject.installments).toHaveLength(3);
    expect(() =>
      deriveLoanState(
        subject,
        [
          {
            amount: amount('60.00'),
            discount: amount('0.00'),
            id: 'q1',
            kind: 'prepayment',
            occurredOn: '2026-02-20',
            recordedAt,
          },
        ],
        date('2026-03-01'),
      ),
    ).toThrow(LoanPrepaymentMismatchError);
  });

  it('recalculates once after reversing a wrong payment and recording the correct one', () => {
    const events: LoanEvent[] = [
      payment('p1', '2026-02-10', '45.00'),
      {
        id: 'r1',
        kind: 'reversal',
        reason: 'Valor digitado errado',
        recordedAt,
        reversedEventId: 'p1',
      },
      payment('p2', '2026-02-10', '40.00'),
    ];
    const state = deriveLoanState(loan(), events, date('2026-02-10'));

    expect(state.pending.toDecimal()).toBe('60.00');
    expect(state.paidTotal.toDecimal()).toBe('40.00');
    expect(state.reversedEventIds).toEqual(['p1']);
  });

  it('marks the open schedule as renegotiated and refuses later payments', () => {
    const renegotiation: LoanEvent = {
      id: 'n1',
      kind: 'renegotiation',
      newLoanId: 'loan-2',
      occurredOn: '2026-02-20',
      recordedAt,
    };
    const state = deriveLoanState(
      loan({ count: 2 }),
      [payment('p1', '2026-02-10', '50.00'), renegotiation],
      date('2026-03-01'),
    );

    expect(state.status).toBe('renegotiated');
    expect(state.installments.map((item) => item.situation)).toEqual([
      'paid',
      'renegotiated',
    ]);
    expect(() =>
      deriveLoanState(
        loan({ count: 2 }),
        [renegotiation, payment('p2', '2026-03-10', '50.00')],
        date('2026-03-10'),
      ),
    ).toThrow(LoanClosedError);
  });

  it.each([
    [
      'reversal of a reversal',
      [
        payment('p1', '2026-02-10', '10.00'),
        {
          id: 'r1',
          kind: 'reversal',
          reason: 'x',
          recordedAt,
          reversedEventId: 'p1',
        },
        {
          id: 'r2',
          kind: 'reversal',
          reason: 'x',
          recordedAt,
          reversedEventId: 'r1',
        },
      ],
    ],
    [
      'double reversal',
      [
        payment('p1', '2026-02-10', '10.00'),
        {
          id: 'r1',
          kind: 'reversal',
          reason: 'x',
          recordedAt,
          reversedEventId: 'p1',
        },
        {
          id: 'r2',
          kind: 'reversal',
          reason: 'x',
          recordedAt,
          reversedEventId: 'p1',
        },
      ],
    ],
    [
      'reversal without reason',
      [
        payment('p1', '2026-02-10', '10.00'),
        {
          id: 'r1',
          kind: 'reversal',
          reason: ' ',
          recordedAt,
          reversedEventId: 'p1',
        },
      ],
    ],
    [
      'duplicate ids',
      [
        payment('p1', '2026-02-10', '10.00'),
        payment('p1', '2026-02-10', '10.00'),
      ],
    ],
    [
      'payment in another currency',
      [
        payment('p1', '2026-02-10', '10.00', {
          amount: Money.fromDecimal(
            '10.00',
            Currency.create('USD', 2),
          ).toSnapshot(),
        }),
      ],
    ],
  ] as const)('rejects %s', (_label, events) => {
    expect(() =>
      deriveLoanState(
        loan(),
        events as readonly LoanEvent[],
        date('2026-02-10'),
      ),
    ).toThrow(InvalidLoanEventError);
  });
});
