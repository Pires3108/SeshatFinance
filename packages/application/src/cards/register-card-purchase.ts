import {
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

export interface CardPurchaseRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  /**
   * Records the purchase, its audit event and the idempotency record in one
   * transaction. Returns the stored response instead of writing when an
   * identical request committed first.
   */
  insertAtomically(
    purchase: CardPurchase,
    auditEvent: FinancialAuditEvent,
    idempotency: IdempotentCardPurchaseRecord,
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
    const { cycle } = await this.cycles.resolve(card, command.occurredAt);
    const purchase = CardPurchase.create({
      amount,
      cardId: card.id,
      categoryId,
      createdAt: at,
      cycleClosesOn: cycle.closesOn,
      description: command.description,
      externalId: command.externalId,
      id: this.identifiers.generate(),
      occurredAt: command.occurredAt,
      ownerId: command.actorId,
    });
    const stored = await this.purchases.insertAtomically(
      purchase,
      FinancialAuditEvent.create({
        action: 'created',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: purchase.id,
        resourceType: 'card-purchase',
      }),
      { request, response: serializeCardPurchaseResponse(purchase) },
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
