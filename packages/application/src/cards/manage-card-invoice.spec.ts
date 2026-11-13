import {
  CardCycleSchedule,
  CardInvoice,
  CivilDate,
  CreditCard,
  Currency,
  Money,
  type FinancialAuditEvent,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { CreditCardRepository } from './create-credit-card.js';
import {
  CardInvoiceNotFoundError,
  CloseCardInvoiceUseCase,
  GetCardInvoiceUseCase,
  invoiceRemaining,
  InvoiceDueStateResolver,
  type CardInvoiceRepository,
  type CardInvoiceView,
} from './manage-card-invoice.js';
import { CreditCardNotFoundError } from './manage-credit-card.js';

const ownerId = 'owner-id';
const brl = Currency.create('BRL', 2);
const card = CreditCard.create({
  brand: 'Visa',
  closingDay: 28,
  createdAt: new Date('2026-09-22T18:00:00.000Z'),
  dueDay: 7,
  id: 'card-id',
  limit: Money.fromDecimal('3500.00', brl),
  name: 'Cartão',
  ownerId,
  paymentAccountId: 'account-id',
});
const cards: CreditCardRepository = {
  findByIdForOwner: (id, actor) =>
    Promise.resolve(id === card.id && actor === ownerId ? card : null),
  insert: () => Promise.resolve(),
  listForOwner: () => Promise.resolve([card]),
  update: () => Promise.resolve(true),
};

function invoices(): CardInvoiceRepository & {
  events: FinancialAuditEvent[];
  view: () => CardInvoiceView;
} {
  let invoice = CardInvoice.form({
    cardId: card.id,
    closingBoundary: 'next-cycle',
    createdAt: new Date('2026-10-20T15:00:00.000Z'),
    currency: brl,
    cycle: CardCycleSchedule.create({
      closingBoundary: 'next-cycle',
      closingDay: 28,
      dueDay: 7,
    }).cycleFor(CivilDate.parse('2026-10-20'), () => false),
    holidayDatasetVersion: 'v1',
    id: 'invoice-id',
    ownerId,
    timeZone: 'America/Sao_Paulo',
  });
  const events: FinancialAuditEvent[] = [];
  const view = (): CardInvoiceView => ({
    invoice,
    purchaseCount: 2,
    purchasesTotal: Money.fromDecimal('130.35', brl),
    settledTotal: Money.fromDecimal('30.00', brl),
  });
  const matches = (closesOn: string, owner: string): boolean =>
    closesOn === '2026-10-28' && owner === ownerId;
  return {
    closeAtomically: (_card, closesOn, owner, close) => {
      if (!matches(closesOn, owner)) return Promise.resolve(null);
      const result = close(invoice, view().purchasesTotal);
      if (result.invoice.version !== invoice.version) {
        events.push(result.auditEvent);
        invoice = result.invoice;
      }
      return Promise.resolve(view());
    },
    events,
    findForCard: (_card, closesOn, owner) =>
      Promise.resolve(matches(closesOn, owner) ? view() : null),
    listForCard: () => Promise.resolve([view()]),
    view,
  };
}

const clock = { now: () => new Date('2026-10-29T12:00:00.000Z') };
const ids = { generate: () => 'audit-id' };
const states = (now: string): InvoiceDueStateResolver =>
  new InvoiceDueStateResolver(
    {
      changeTimeZone: () => Promise.resolve(null),
      findById: () => Promise.resolve(null),
      upsert: (profile) => Promise.resolve(profile),
    },
    { now: () => new Date(now) },
  );

describe('CloseCardInvoiceUseCase', () => {
  it('freezes the purchases total once and audits only the change', async () => {
    const repository = invoices();
    const useCase = new CloseCardInvoiceUseCase(
      cards,
      repository,
      clock,
      ids,
      states('2026-10-29T12:00:00.000Z'),
    );
    const command = {
      actorId: ownerId,
      cardId: card.id,
      closesOn: '2026-10-28',
    };

    const first = await useCase.execute(command);
    const second = await useCase.execute(command);

    expect(first.invoice.toSnapshot()).toMatchObject({
      closedTotal: { amount: '130.35' },
      status: 'closed',
    });
    expect(second.invoice.version).toBe(first.invoice.version);
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]?.toSnapshot()).toMatchObject({
      action: 'closed',
      resourceType: 'card-invoice',
    });
  });

  it.each([
    ['another holder', { actorId: 'intruder' }, CreditCardNotFoundError],
    ['a missing invoice', { closesOn: '2026-09-28' }, CardInvoiceNotFoundError],
  ])('rejects %s', async (_label, change, error) => {
    await expect(
      new CloseCardInvoiceUseCase(
        cards,
        invoices(),
        clock,
        ids,
        states('2026-10-29T12:00:00.000Z'),
      ).execute({
        actorId: ownerId,
        cardId: card.id,
        closesOn: '2026-10-28',
        ...change,
      }),
    ).rejects.toThrow(error);
  });
});

describe('GetCardInvoiceUseCase', () => {
  it('returns the invoice with its purchases as memory of calculation', async () => {
    const detail = await new GetCardInvoiceUseCase(
      cards,
      invoices(),
      {
        listForCard: (_card, _owner, closesOn) =>
          Promise.resolve(closesOn === '2026-10-28' ? [] : []),
      },
      { listForInvoice: () => Promise.resolve([]) },
      // 10/11 23:30 in São Paulo is the day after the 09/11 due date.
      states('2026-11-11T02:30:00.000Z'),
    ).execute({ actorId: ownerId, cardId: card.id, closesOn: '2026-10-28' });

    expect(detail.purchaseCount).toBe(2);
    expect(detail.due).toEqual({ daysUntilDue: -1, state: 'overdue' });
    expect(detail.attentionDays).toBe(5);
    expect(invoiceRemaining(detail).toDecimal()).toBe('100.35');
  });
});
