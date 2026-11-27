import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { Investment } from './investment.js';
import {
  InvalidInvestmentEventError,
  InvestmentEvent,
  investmentEventAccountEffect,
  investmentEventKinds,
  isInvestmentIncomeKind,
  isInvestmentMovementKind,
  type CreateInvestmentEventProperties,
} from './investment-event.js';
import { InvestmentType, type InvestmentTypeKey } from './investment-type.js';

const brl = Currency.create('BRL', 2);
const created = new Date('2026-11-27T12:00:00.000Z');
const later = new Date('2026-11-28T12:00:00.000Z');

function investment(type: InvestmentTypeKey = 'stock'): Investment {
  return Investment.create({
    code: null,
    contractedRate: null,
    createdAt: created,
    currency: brl,
    id: 'investment-id',
    institution: 'Corretora Exemplo',
    liquidity: { kind: 'daily' },
    maturityDate: null,
    name: 'Ativo',
    ownerId: 'owner-id',
    startDate: CivilDate.parse('2026-03-01'),
    type: InvestmentType.create(type),
  });
}

function event(
  overrides: Partial<CreateInvestmentEventProperties> = {},
): InvestmentEvent {
  return InvestmentEvent.create({
    accountId: 'account-id',
    amount: Money.fromDecimal('1500.00', brl),
    createdAt: created,
    id: 'event-id',
    investment: investment(),
    kind: 'contribution',
    note: '  compra inicial  ',
    occurredAt: new Date('2026-03-10T15:00:00.000Z'),
    quantity: '100',
    timeZone: 'America/Sao_Paulo',
    transactionId: 'transaction-id',
    unitPrice: '15.00',
    ...overrides,
  });
}

describe('InvestmentEvent (US-055, RN-073)', () => {
  it('records an aporte with quantity, price and linked account entry', () => {
    expect(event().toSnapshot()).toEqual({
      accountId: 'account-id',
      amount: { amount: '1500.00', currency: brl.toSnapshot() },
      createdAt: created,
      id: 'event-id',
      investmentId: 'investment-id',
      kind: 'contribution',
      lifecycle: 'active',
      note: 'compra inicial',
      occurredAt: new Date('2026-03-10T15:00:00.000Z'),
      occurredOn: '2026-03-10',
      ownerId: 'owner-id',
      quantity: '100',
      timeZone: 'America/Sao_Paulo',
      transactionId: 'transaction-id',
      unitPrice: '15',
      updatedAt: created,
      version: 1,
    });
  });

  it('derives the civil date in the declared time zone (ADR-034)', () => {
    const lateNight = new Date('2026-03-11T02:30:00.000Z');
    expect(event({ occurredAt: lateNight }).toSnapshot().occurredOn).toBe(
      '2026-03-10',
    );
    expect(
      event({ occurredAt: lateNight, timeZone: 'UTC' }).toSnapshot().occurredOn,
    ).toBe('2026-03-11');
    for (const timeZone of ['', '-03:00', 'Not/AZone']) {
      expect(() => event({ timeZone })).toThrow(InvalidInvestmentEventError);
    }
  });

  it('classifies the account effect of each kind', () => {
    expect(investmentEventKinds).toHaveLength(7);
    expect(investmentEventAccountEffect('contribution')).toBe('expense');
    expect(investmentEventAccountEffect('redemption')).toBe('income');
    expect(investmentEventAccountEffect('yield')).toBe('income');
    expect(investmentEventAccountEffect('dividend')).toBe('income');
    expect(investmentEventAccountEffect('interest')).toBe('income');
    expect(investmentEventAccountEffect('fee')).toBeNull();
    expect(investmentEventAccountEffect('tax')).toBeNull();
    expect(isInvestmentMovementKind('redemption')).toBe(true);
    expect(isInvestmentMovementKind('dividend')).toBe(false);
    expect(isInvestmentIncomeKind('interest')).toBe(true);
    expect(isInvestmentIncomeKind('fee')).toBe(false);
  });

  it('requires a positive amount in the investment currency', () => {
    expect(() => event({ amount: Money.fromDecimal('0', brl) })).toThrow(
      InvalidInvestmentEventError,
    );
    expect(() => event({ amount: Money.fromDecimal('-1', brl) })).toThrow(
      InvalidInvestmentEventError,
    );
    expect(() =>
      event({
        amount: Money.fromDecimal('10', Currency.create('USD', 2)),
      }),
    ).toThrow(InvalidInvestmentEventError);
  });

  it('applies the quantity scale of the type (RN-072)', () => {
    expect(() => event({ quantity: '1.5' })).toThrow(
      InvalidInvestmentEventError,
    );
    expect(() => event({ quantity: null })).toThrow(
      InvalidInvestmentEventError,
    );
    expect(() => event({ quantity: '0' })).toThrow(InvalidInvestmentEventError);
    expect(() => event({ unitPrice: '1.123456789' })).toThrow(
      InvalidInvestmentEventError,
    );
    const crypto = event({
      investment: investment('cryptocurrency'),
      quantity: '0.00012345',
      unitPrice: null,
    }).toSnapshot();
    expect(crypto).toMatchObject({ quantity: '0.00012345', unitPrice: null });
  });

  it('keeps value-only types and non-movement events without quantity', () => {
    const cdb = investment('cdb');
    expect(
      event({ investment: cdb, quantity: null, unitPrice: null }).toSnapshot(),
    ).toMatchObject({ quantity: null, unitPrice: null });
    expect(() => event({ investment: cdb })).toThrow(
      InvalidInvestmentEventError,
    );
    expect(() => event({ kind: 'dividend' })).toThrow(
      InvalidInvestmentEventError,
    );
    expect(
      event({ kind: 'dividend', quantity: null, unitPrice: null }).kind,
    ).toBe('dividend');
  });

  it('keeps fees and taxes away from accounts', () => {
    const fee = {
      accountId: null,
      kind: 'fee' as const,
      quantity: null,
      transactionId: null,
      unitPrice: null,
    };
    expect(event(fee).toSnapshot()).toMatchObject({
      accountId: null,
      kind: 'fee',
      transactionId: null,
    });
    expect(() =>
      event({ ...fee, accountId: 'account-id', transactionId: 'tx' }),
    ).toThrow(InvalidInvestmentEventError);
    expect(() => event({ transactionId: null })).toThrow(
      InvalidInvestmentEventError,
    );
  });

  it('accepts an aporte without account as a pre-existing position', () => {
    expect(
      event({ accountId: null, transactionId: null }).toSnapshot(),
    ).toMatchObject({ accountId: null, transactionId: null });
  });

  it('rejects events before the start date or on an inactive investment', () => {
    expect(() =>
      event({ occurredAt: new Date('2026-02-28T15:00:00.000Z') }),
    ).toThrow(InvalidInvestmentEventError);
    const archived = investment();
    archived.archive(later);
    expect(() => event({ investment: archived })).toThrow(
      InvalidInvestmentEventError,
    );
  });

  it('moves to the trash and back with a new version each time', () => {
    const recorded = event();
    recorded.trash(later);
    expect(recorded.lifecycle).toBe('trashed');
    expect(() => {
      recorded.trash(later);
    }).toThrow(InvalidInvestmentEventError);
    recorded.restoreFromTrash(later);
    expect(recorded.toSnapshot()).toMatchObject({
      lifecycle: 'active',
      updatedAt: later,
      version: 3,
    });
    expect(() => {
      recorded.restoreFromTrash(later);
    }).toThrow(InvalidInvestmentEventError);
    expect(() => {
      recorded.trash(new Date('2026-11-01T00:00:00.000Z'));
    }).toThrow(InvalidInvestmentEventError);
  });

  it('round-trips through a snapshot', () => {
    const snapshot = event().toSnapshot();
    expect(InvestmentEvent.restore(snapshot).toSnapshot()).toEqual(snapshot);
    expect(() => InvestmentEvent.restore({ ...snapshot, version: 0 })).toThrow(
      InvalidInvestmentEventError,
    );
  });
});
