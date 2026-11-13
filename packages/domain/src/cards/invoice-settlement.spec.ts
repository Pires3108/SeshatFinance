import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import {
  InvalidInvoiceSettlementError,
  InvoiceSettlement,
} from './invoice-settlement.js';

const brl = Currency.create('BRL', 2);
const base = {
  accountId: 'account-id',
  amount: Money.fromDecimal('50.00', brl),
  cardId: 'card-id',
  createdAt: new Date('2026-11-05T12:00:00.000Z'),
  id: 'settlement-id',
  invoiceClosesOn: CivilDate.parse('2026-10-28'),
  ownerId: 'owner-id',
  paidAt: new Date('2026-11-05T10:00:00.000Z'),
  transactionId: 'transaction-id',
} as const;

describe('InvoiceSettlement', () => {
  it('records the declared payment and restores from its snapshot', () => {
    const settlement = InvoiceSettlement.create(base);
    expect(settlement.toSnapshot()).toMatchObject({
      amount: { amount: '50.00' },
      invoiceClosesOn: '2026-10-28',
    });
    expect(
      InvoiceSettlement.restore(settlement.toSnapshot()).toSnapshot(),
    ).toEqual(settlement.toSnapshot());
  });

  it.each([
    ['zero amount', { amount: Money.fromDecimal('0', brl) }],
    ['missing account', { accountId: ' ' }],
    ['invalid instant', { paidAt: new Date('invalid') }],
  ])('rejects %s', (_label, change) => {
    expect(() => InvoiceSettlement.create({ ...base, ...change })).toThrow(
      InvalidInvoiceSettlementError,
    );
  });
});
