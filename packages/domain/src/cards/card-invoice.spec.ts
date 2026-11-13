import { describe, expect, it } from 'vitest';

import { CivilDate } from '../calendar/civil-date.js';
import { Currency } from '../money/currency.js';
import { Money } from '../money/money.js';
import { CardCycleSchedule } from './card-cycle-schedule.js';
import { CardInvoice, InvalidCardInvoiceError } from './card-invoice.js';

const brl = Currency.create('BRL', 2);
const cycle = CardCycleSchedule.create({
  closingBoundary: 'next-cycle',
  closingDay: 28,
  dueDay: 7,
}).cycleFor(CivilDate.parse('2026-10-20'), () => false);

function invoice(): CardInvoice {
  return CardInvoice.form({
    cardId: 'card-id',
    closingBoundary: 'next-cycle',
    createdAt: new Date('2026-10-20T15:00:00.000Z'),
    currency: brl,
    cycle,
    holidayDatasetVersion: '2026.11.13-2',
    id: 'invoice-id',
    ownerId: 'owner-id',
    timeZone: 'America/Sao_Paulo',
  });
}

describe('CardInvoice', () => {
  it('freezes the cycle dates, rule and dataset when formed', () => {
    expect(invoice().toSnapshot()).toMatchObject({
      closedAt: null,
      closedTotal: null,
      closesOn: '2026-10-28',
      dueOn: '2026-11-09',
      firstPurchaseDate: '2026-09-28',
      holidayDatasetVersion: '2026.11.13-2',
      lastPurchaseDate: '2026-10-27',
      scheduledDueOn: '2026-11-07',
      status: 'open',
      version: 1,
    });
  });

  it('closes once with the frozen total and ignores a second close', () => {
    const at = new Date('2026-10-29T12:00:00.000Z');
    const closed = invoice().close(Money.fromDecimal('130.35', brl), at);

    expect(closed.toSnapshot()).toMatchObject({
      closedAt: at,
      closedTotal: { amount: '130.35' },
      status: 'closed',
      version: 2,
    });
    expect(
      closed.close(Money.fromDecimal('999.00', brl), new Date()).toSnapshot(),
    ).toEqual(closed.toSnapshot());
  });

  it('rejects a total in another currency', () => {
    expect(() =>
      invoice().close(
        Money.fromDecimal('1.00', Currency.create('USD', 2)),
        new Date(),
      ),
    ).toThrow(InvalidCardInvoiceError);
  });

  it('rejects an inconsistent snapshot', () => {
    expect(() =>
      CardInvoice.restore({ ...invoice().toSnapshot(), status: 'closed' }),
    ).toThrow(InvalidCardInvoiceError);
    expect(() =>
      CardInvoice.restore({
        ...invoice().toSnapshot(),
        dueOn: '2026-11-01',
      }),
    ).toThrow(InvalidCardInvoiceError);
  });
});
