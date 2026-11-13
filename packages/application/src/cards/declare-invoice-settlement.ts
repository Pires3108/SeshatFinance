import {
  CivilDate,
  Currency,
  FinancialAuditEvent,
  InvoiceSettlement,
  Money,
  Transaction,
  type InvoiceSettlementSnapshot,
} from '@seshat/domain';

import type { AccountRepository } from '../accounts/create-account.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { CreditCardRepository } from './create-credit-card.js';
import { CardInvoiceNotFoundError } from './manage-card-invoice.js';
import { CreditCardNotFoundError } from './manage-credit-card.js';

export const DECLARE_INVOICE_SETTLEMENT_OPERATION = 'invoice-settlement.create';

export type DeclareInvoiceSettlementCommand = Readonly<{
  actorId: string;
  cardId: string;
  invoiceClosesOn: string;
  accountId: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  paidAt: Date;
  idempotencyKey: string;
}>;

/** Everything written for one settlement, in one transaction. */
export type InvoiceSettlementWrite = Readonly<{
  settlement: InvoiceSettlement;
  transaction: Transaction;
  auditEvents: readonly FinancialAuditEvent[];
  response: string;
}>;

export interface InvoiceSettlementRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  /**
   * In one transaction: claims the key, locks the invoice, compares the
   * amount with the remaining obligation (purchases minus settlements) and
   * writes the account movement, the settlement, the audit events and the
   * idempotency record. Returns the stored response on replay, null when the
   * invoice does not exist, and throws InvoiceSettlementExceedsRemainingError
   * when the amount is above the remaining obligation.
   */
  settleAtomically(
    request: IdempotencyRequest,
    cardId: string,
    invoiceClosesOn: string,
    write: InvoiceSettlementWrite,
  ): Promise<string | null>;
}

export class InvoiceSettlementAccountUnavailableError extends Error {
  public constructor() {
    super('Owned active paying account was not found.');
    this.name = 'InvoiceSettlementAccountUnavailableError';
  }
}

export class InvoiceSettlementCurrencyMismatchError extends Error {
  public constructor() {
    super('Settlement, account and card must share one currency.');
    this.name = 'InvoiceSettlementCurrencyMismatchError';
  }
}

/** Decided on 13/11/2026: an excess payment is rejected, never stored. */
export class InvoiceSettlementExceedsRemainingError extends Error {
  public constructor() {
    super('Settlement amount is above the remaining invoice obligation.');
    this.name = 'InvoiceSettlementExceedsRemainingError';
  }
}

/**
 * Records a payment the holder declares to have made outside the app. The
 * paying account and the obligation drop by the same amount; the purchase
 * already carries the expense, so no expense or income is created.
 */
export class DeclareInvoiceSettlementUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly accounts: AccountRepository,
    private readonly settlements: InvoiceSettlementRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: DeclareInvoiceSettlementCommand,
  ): Promise<InvoiceSettlement> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const invoiceClosesOn = CivilDate.parse(command.invoiceClosesOn);
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    const amount = Money.fromDecimal(command.amount, currency);
    const at = this.clock.now();
    const request: IdempotencyRequest = {
      key,
      operation: DECLARE_INVOICE_SETTLEMENT_OPERATION,
      ownerId: command.actorId,
      payload: {
        accountId: command.accountId.toLowerCase(),
        amount: amount.toDecimal(),
        cardId: command.cardId.toLowerCase(),
        currencyCode: currency.code,
        currencyMinorUnitScale: currency.minorUnitScale,
        invoiceClosesOn: invoiceClosesOn.toString(),
        paidAt: command.paidAt.toISOString(),
      },
      requestedAt: at,
    };
    const replayed = await this.settlements.findIdempotentResponse(request);
    if (replayed !== null) return parseInvoiceSettlementResponse(replayed);

    const card = await this.cards.findByIdForOwner(
      command.cardId,
      command.actorId,
    );
    if (card === null) throw new CreditCardNotFoundError();
    const account = await this.accounts.findByIdForOwner(
      command.accountId,
      command.actorId,
    );
    if (account?.lifecycle !== 'active') {
      throw new InvoiceSettlementAccountUnavailableError();
    }
    if (
      !currency.equals(card.limit.currency) ||
      !currency.equals(account.initialBalance.currency)
    ) {
      throw new InvoiceSettlementCurrencyMismatchError();
    }
    const cardName = card.toSnapshot().name;
    const transaction = Transaction.create({
      accountId: account.id,
      amount,
      createdAt: at,
      description: `Pagamento da fatura ${cardName} (${invoiceClosesOn.toString()})`,
      id: this.identifiers.generate(),
      kind: 'expense',
      occurredAt: command.paidAt,
      ownerId: command.actorId,
    });
    const settlement = InvoiceSettlement.create({
      accountId: account.id,
      amount,
      cardId: card.id,
      createdAt: at,
      id: this.identifiers.generate(),
      invoiceClosesOn,
      ownerId: command.actorId,
      paidAt: command.paidAt,
      transactionId: transaction.id,
    });
    const audit = (
      resourceId: string,
      resourceType: 'transaction' | 'invoice-settlement',
    ): FinancialAuditEvent =>
      FinancialAuditEvent.create({
        action: 'created',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId,
        resourceType,
      });
    const stored = await this.settlements.settleAtomically(
      request,
      card.id,
      invoiceClosesOn.toString(),
      {
        auditEvents: [
          audit(transaction.id, 'transaction'),
          audit(settlement.id, 'invoice-settlement'),
        ],
        response: serializeInvoiceSettlementResponse(settlement),
        settlement,
        transaction,
      },
    );
    if (stored === null) throw new CardInvoiceNotFoundError();
    return parseInvoiceSettlementResponse(stored);
  }
}

const dateFields = new Set(['createdAt', 'paidAt']);

export function serializeInvoiceSettlementResponse(
  settlement: InvoiceSettlement,
): string {
  return JSON.stringify(settlement.toSnapshot());
}

export function parseInvoiceSettlementResponse(
  response: string,
): InvoiceSettlement {
  const snapshot = JSON.parse(response, (key: string, value: unknown) =>
    dateFields.has(key) && typeof value === 'string' ? new Date(value) : value,
  ) as InvoiceSettlementSnapshot;
  return InvoiceSettlement.restore(snapshot);
}
