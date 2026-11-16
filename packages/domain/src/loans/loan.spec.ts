import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { InterestRate } from '../interest/interest-rate.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { InvalidLoanError, Loan } from './loan.js';

const brl = Currency.create('BRL', 2);
const base = {
  businessDayRule: 'next-business-day' as const,
  contractedOn: CivilDate.parse('2026-01-05'),
  count: 3,
  createdAt: new Date('2026-01-05T12:00:00.000Z'),
  description: 'Financiamento',
  direction: 'payable' as const,
  // 2026-02-14 is a Saturday: the first due date moves to Monday.
  firstDueOn: CivilDate.parse('2026-02-14'),
  id: 'loan-id',
  isHoliday: () => false,
  lateFeePercent: '2',
  ownerId: 'owner-id',
  principal: Money.fromDecimal('1000.00', brl),
  profile: 'constant' as const,
  rate: InterestRate.create({
    method: 'compound',
    percentPerPeriod: '1',
    periodicity: 'monthly',
  }),
};

describe('Loan', () => {
  it('freezes schedule, parameters and effective due dates and restores them', () => {
    const loan = Loan.create(base);
    const snapshot = loan.toSnapshot();

    expect(snapshot.installments[0]).toMatchObject({
      dueOn: '2026-02-16',
      scheduledDueOn: '2026-02-14',
    });
    expect(Loan.restore(snapshot).toSnapshot()).toEqual(snapshot);
  });

  it('rejects a stored schedule that does not match its parameters', () => {
    const snapshot = Loan.create(base).toSnapshot();
    const tampered = {
      ...snapshot,
      installments: snapshot.installments.map((item, index) =>
        index === 0
          ? { ...item, amount: { ...item.amount, amount: '1.00' } }
          : item,
      ),
    };

    expect(() => Loan.restore(tampered)).toThrow(InvalidLoanError);
  });

  it.each([
    ['blank description', { description: ' ' }],
    [
      'first due before the contract',
      { firstDueOn: CivilDate.parse('2026-01-01') },
    ],
    ['late fee above 100%', { lateFeePercent: '100.5' }],
    [
      'repeated allocation component',
      { allocationOrder: ['fee', 'fee', 'principal'] as const },
    ],
    ['zero principal', { principal: Money.fromDecimal('0.00', brl) }],
  ])('rejects %s', (_label, change) => {
    expect(() => Loan.create({ ...base, ...change })).toThrow(InvalidLoanError);
  });
});
