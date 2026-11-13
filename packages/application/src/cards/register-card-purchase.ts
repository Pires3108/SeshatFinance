import {
  CardInvoice,
  CardPurchase,
  Currency,
  FinancialAuditEvent,
  Money,
  type CardPurchaseSnapshot,
} from '@seshat/domain';

import type { CategoryRepository } from '../classifications/manage-category.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { CreditCardRepository } from './create-credit-card.js';
import {
  CreditCardNotFoundError,
  type CardCycleResolver,
} from './manage-credit-card.js';

export const REGISTER_CARD_PURCHASE_OPERATION = 'card-purchase.create';

export type RegisterCardPurchaseCommand = Readonly<{
  actorId: string;
  amount: string;
  cardId: string;
  categoryId?: string | null | undefined;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string;
  externalId?: string | null | undefined;
  idempotencyKey: string;
  occurredAt: Date;
}>;

export type IdempotentCardPurchaseRecord = Readonly<{
  request: IdempotencyRequest;
  response: string;
}>;

/** Number of cycles searched for an open invoice (one year). */
export const INVOICE_ROUTING_CYCLES = 13;

/** Built once the destination invoice is known, inside the transaction. */
export type CardPurchaseWrite = Readonly<{
  purchase: CardPurchase;
  auditEvent: FinancialAuditEvent;
  response: string;
}>;

export interface CardPurchaseRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  /**
   * In one transaction: claims the idempotency key, forms or locks the
   * candidate invoices in order and picks the first open one, then writes the
   * purchase built for it, its audit event and the idempotency record.
   * Returns the stored response instead of writing when an identical request
   * committed first. Closed invoices are never changed.
   */
  insertAtomically(
    request: IdempotencyRequest,
    candidates: readonly CardInvoice[],
    build: (
      invoice: CardInvoice,
      postedAfterClose: boolean,
    ) => CardPurchaseWrite,
  ): Promise<string>;
  listForCard(
    cardId: string,
    ownerId: string,
    cycleClosesOn?: string,
  ): Promise<readonly CardPurchase[]>;
}

export class CardPurchaseCurrencyMismatchError extends Error {
  public constructor() {
    super('Card purchase currency must match the credit card currency.');
    this.name = 'CardPurchaseCurrencyMismatchError';
  }
}

export class CardPurchaseCategoryUnavailableError extends Error {
  public constructor() {
    super('Owned category was not found.');
    this.name = 'CardPurchaseCategoryUnavailableError';
  }
}

/**
 * Records a purchase already made with the card (INV-014): one expense and the
 * same obligation in exactly one cycle, without touching the paying account.
 */
export class RegisterCardPurchaseUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly purchases: CardPurchaseRepository,
    private readonly categories: Pick<CategoryRepository, 'findByIdForOwner'>,
    private readonly cycles: CardCycleResolver,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: RegisterCardPurchaseCommand,
  ): Promise<CardPurchase> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    const amount = Money.fromDecimal(command.amount, currency);
    const at = this.clock.now();
    const request: IdempotencyRequest = {
      key,
      operation: REGISTER_CARD_PURCHASE_OPERATION,
      ownerId: command.actorId,
      payload: {
        amount: amount.toDecimal(),
        cardId: command.cardId.toLowerCase(),
        categoryId: command.categoryId?.toLowerCase() ?? null,
        currencyCode: currency.code,
        currencyMinorUnitScale: currency.minorUnitScale,
        description: command.description.trim(),
        externalId: command.externalId?.trim() ?? null,
        occurredAt: command.occurredAt.toISOString(),
      },
      requestedAt: at,
    };
    const replayed = await this.purchases.findIdempotentResponse(request);
    if (replayed !== null) return parseCardPurchaseResponse(replayed);

    const card = await this.cards.findByIdForOwner(
      command.cardId,
      command.actorId,
    );
    if (card === null) throw new CreditCardNotFoundError();
    if (!currency.equals(card.limit.currency)) {
      throw new CardPurchaseCurrencyMismatchError();
    }
    const categoryId = command.categoryId ?? null;
    if (
      categoryId !== null &&
      (await this.categories.findByIdForOwner(categoryId, command.actorId)) ===
        null
    ) {
      throw new CardPurchaseCategoryUnavailableError();
    }
    const resolved = await this.cycles.resolve(card, command.occurredAt);
    const candidates = resolved
      .followingCycles(INVOICE_ROUTING_CYCLES)
      .map((cycle) =>
        CardInvoice.form({
          cardId: card.id,
          closingBoundary: card.toSnapshot().closingBoundary,
          createdAt: at,
          currency,
          cycle,
          holidayDatasetVersion: resolved.holidayDatasetVersion,
          id: this.identifiers.generate(),
          ownerId: command.actorId,
          timeZone: resolved.timeZone,
        }),
      );
    const purchaseId = this.identifiers.generate();
    const auditId = this.identifiers.generate();
    const build = (
      invoice: CardInvoice,
      postedAfterClose: boolean,
    ): CardPurchaseWrite => {
      const purchase = CardPurchase.create({
        amount,
        cardId: card.id,
        categoryId,
        createdAt: at,
        cycleClosesOn: invoice.closesOn,
        description: command.description,
        externalId: command.externalId,
        id: purchaseId,
        occurredAt: command.occurredAt,
        ownerId: command.actorId,
        postedAfterClose,
      });
      return {
        auditEvent: FinancialAuditEvent.create({
          action: 'created',
          actorId: command.actorId,
          id: auditId,
          occurredAt: at,
          ownerId: command.actorId,
          resourceId: purchase.id,
          resourceType: 'card-purchase',
        }),
        purchase,
        response: serializeCardPurchaseResponse(purchase),
      };
    };
    // Validates the purchase before opening the transaction.
    const first = candidates[0];
    if (first === undefined) throw new Error('No invoice candidate.');
    build(first, false);
    const stored = await this.purchases.insertAtomically(
      request,
      candidates,
      build,
    );
    return parseCardPurchaseResponse(stored);
  }
}

export class ListCardPurchasesUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly purchases: CardPurchaseRepository,
  ) {}

  public async execute(
    query: Readonly<{
      actorId: string;
      cardId: string;
      cycleClosesOn?: string;
    }>,
  ): Promise<readonly CardPurchase[]> {
    const card = await this.cards.findByIdForOwner(query.cardId, query.actorId);
    if (card === null) throw new CreditCardNotFoundError();
    return this.purchases.listForCard(
      card.id,
      query.actorId,
      query.cycleClosesOn,
    );
  }
}

const dateFields = new Set(['createdAt', 'occurredAt']);

/** Serializes the purchase exactly as recorded, for idempotent replay. */
export function serializeCardPurchaseResponse(purchase: CardPurchase): string {
  return JSON.stringify(purchase.toSnapshot());
}

export function parseCardPurchaseResponse(response: string): CardPurchase {
  const snapshot = JSON.parse(response, (key: string, value: unknown) =>
    dateFields.has(key) && typeof value === 'string' ? new Date(value) : value,
  ) as CardPurchaseSnapshot;
  return CardPurchase.restore(snapshot);
}
