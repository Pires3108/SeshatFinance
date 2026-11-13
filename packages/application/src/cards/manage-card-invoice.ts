import {
  CivilDate,
  deriveInvoiceDueState,
  FinancialAuditEvent,
  Money,
  type CreditCard,
  type InvoiceDueStateView,
  type CardInvoice,
  type CardPurchase,
  type InvoiceSettlement,
} from '@seshat/domain';

import { readCivilDate } from '../ports/civil-date.js';
import type { Clock } from '../ports/clock.js';
import type { UserProfileRepository } from '../users/update-own-user-profile.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import type { CreditCardRepository } from './create-credit-card.js';
import { CreditCardNotFoundError } from './manage-credit-card.js';

/** An invoice with the reconciled sums of its components (INV-017). */
export type CardInvoiceView = Readonly<{
  invoice: CardInvoice;
  /** Sum of the purchases that belong to the invoice. */
  purchasesTotal: Money;
  /** Sum of declared settlements (US-041); zero until then. */
  settledTotal: Money;
  purchaseCount: number;
}>;

export interface CardInvoiceRepository {
  listForCard(
    cardId: string,
    ownerId: string,
  ): Promise<readonly CardInvoiceView[]>;
  findForCard(
    cardId: string,
    closesOn: string,
    ownerId: string,
  ): Promise<CardInvoiceView | null>;
  /**
   * Locks the invoice, sums its purchases and lets `close` decide the closed
   * state in one transaction. Writes the audit event only when the invoice
   * changes. Returns null when the invoice does not exist for the owner.
   */
  closeAtomically(
    cardId: string,
    closesOn: string,
    ownerId: string,
    close: (
      invoice: CardInvoice,
      purchasesTotal: Money,
    ) => Readonly<{ invoice: CardInvoice; auditEvent: FinancialAuditEvent }>,
  ): Promise<CardInvoiceView | null>;
}

/** Invoice view with its server-derived due state (US-042). */
export type CardInvoiceStateView = CardInvoiceView &
  Readonly<{ attentionDays: number; due: InvoiceDueStateView }>;

/** Derives due states with the holder's time zone and injected clock. */
export class InvoiceDueStateResolver {
  public constructor(
    private readonly profiles: UserProfileRepository,
    private readonly clock: Clock,
  ) {}

  public async today(ownerId: string): Promise<CivilDate> {
    const profile = await this.profiles.findById(ownerId);
    return CivilDate.parse(
      readCivilDate(this.clock, profile?.timeZone ?? 'America/Sao_Paulo'),
    );
  }

  public static apply(
    view: CardInvoiceView,
    card: CreditCard,
    today: CivilDate,
  ): CardInvoiceStateView {
    return {
      ...view,
      attentionDays: card.attentionDays,
      due: deriveInvoiceDueState({
        attentionDays: card.attentionDays,
        dueOn: CivilDate.parse(view.invoice.toSnapshot().dueOn),
        purchasesMinorUnits: view.purchasesTotal.toMinorUnits(),
        remainingMinorUnits: invoiceRemaining(view).toMinorUnits(),
        today,
      }),
    };
  }
}

export interface CardInvoicePurchaseReader {
  listForCard(
    cardId: string,
    ownerId: string,
    cycleClosesOn?: string,
  ): Promise<readonly CardPurchase[]>;
}

export interface InvoiceSettlementReader {
  listForInvoice(
    cardId: string,
    invoiceClosesOn: string,
    ownerId: string,
  ): Promise<readonly InvoiceSettlement[]>;
}

export class CardInvoiceNotFoundError extends Error {
  public constructor() {
    super('Owned card invoice was not found.');
    this.name = 'CardInvoiceNotFoundError';
  }
}

export class ListCardInvoicesUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly invoices: CardInvoiceRepository,
    private readonly states: InvoiceDueStateResolver,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; cardId: string }>,
  ): Promise<readonly CardInvoiceStateView[]> {
    const card = await this.cards.findByIdForOwner(query.cardId, query.actorId);
    if (card === null) throw new CreditCardNotFoundError();
    const today = await this.states.today(query.actorId);
    const views = await this.invoices.listForCard(card.id, query.actorId);
    return views.map((view) =>
      InvoiceDueStateResolver.apply(view, card, today),
    );
  }
}

export type CardInvoiceDetail = CardInvoiceStateView &
  Readonly<{
    purchases: readonly CardPurchase[];
    settlements: readonly InvoiceSettlement[];
  }>;

/** Invoice with its purchases, the memory of calculation of its total. */
export class GetCardInvoiceUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly invoices: CardInvoiceRepository,
    private readonly purchases: CardInvoicePurchaseReader,
    private readonly settlements: InvoiceSettlementReader,
    private readonly states: InvoiceDueStateResolver,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; cardId: string; closesOn: string }>,
  ): Promise<CardInvoiceDetail> {
    const closesOn = CivilDate.parse(query.closesOn).toString();
    const card = await this.cards.findByIdForOwner(query.cardId, query.actorId);
    if (card === null) throw new CreditCardNotFoundError();
    const view = await this.invoices.findForCard(
      card.id,
      closesOn,
      query.actorId,
    );
    if (view === null) throw new CardInvoiceNotFoundError();
    return {
      ...InvoiceDueStateResolver.apply(
        view,
        card,
        await this.states.today(query.actorId),
      ),
      purchases: await this.purchases.listForCard(
        card.id,
        query.actorId,
        closesOn,
      ),
      settlements: await this.settlements.listForInvoice(
        card.id,
        closesOn,
        query.actorId,
      ),
    };
  }
}

/**
 * Manual closing (US-040): freezes the purchases total. It creates no expense
 * and never touches the paying account; closing twice changes nothing.
 */
export class CloseCardInvoiceUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly invoices: CardInvoiceRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
    private readonly states: InvoiceDueStateResolver,
  ) {}

  public async execute(
    command: Readonly<{ actorId: string; cardId: string; closesOn: string }>,
  ): Promise<CardInvoiceStateView> {
    const closesOn = CivilDate.parse(command.closesOn).toString();
    const card = await this.cards.findByIdForOwner(
      command.cardId,
      command.actorId,
    );
    if (card === null) throw new CreditCardNotFoundError();
    const at = this.clock.now();
    const view = await this.invoices.closeAtomically(
      card.id,
      closesOn,
      command.actorId,
      (invoice, purchasesTotal) => ({
        auditEvent: FinancialAuditEvent.create({
          action: 'closed',
          actorId: command.actorId,
          id: this.identifiers.generate(),
          occurredAt: at,
          ownerId: command.actorId,
          resourceId: invoice.id,
          resourceType: 'card-invoice',
        }),
        invoice: invoice.close(purchasesTotal, at),
      }),
    );
    if (view === null) throw new CardInvoiceNotFoundError();
    return InvoiceDueStateResolver.apply(
      view,
      card,
      await this.states.today(command.actorId),
    );
  }
}

/** Remaining obligation of an invoice: purchases minus settlements. */
export function invoiceRemaining(view: CardInvoiceView): Money {
  return Money.fromMinorUnits(
    view.purchasesTotal.toMinorUnits() - view.settledTotal.toMinorUnits(),
    view.purchasesTotal.currency,
  );
}
