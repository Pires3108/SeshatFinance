import {
  calculateInstallmentPlan,
  CardInstallmentPlan,
  CardInvoice,
  FinancialAuditEvent,
  InterestRate,
  type CardCycle,
  type CardInstallmentPlanSnapshot,
  type CardPurchase,
  type CreditCard,
  type InstallmentPlan,
} from '@seshat/domain';

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
import { INVOICE_ROUTING_CYCLES } from './register-card-purchase.js';

export const REGISTER_CARD_INSTALLMENT_PLAN_OPERATION =
  'card-installment-plan.create';

export type CardInstallmentRateInput = Readonly<{
  method: string;
  percentPerPeriod: string;
  periodicity: string;
}>;

export type CardInstallmentPlanQuery = Readonly<{
  actorId: string;
  cardId: string;
  purchaseId: string;
  count: number;
  rate?: CardInstallmentRateInput | null | undefined;
}>;

export type RegisterCardInstallmentPlanCommand = CardInstallmentPlanQuery &
  Readonly<{ idempotencyKey: string }>;

export type CardInstallmentPlanPreview = Readonly<{
  plan: InstallmentPlan;
  cycles: readonly CardCycle[];
}>;

export type CardInstallmentPlanWrite = Readonly<{
  plan: CardInstallmentPlan;
  auditEvent: FinancialAuditEvent;
  response: string;
}>;

export interface CardInstallmentPlanRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  findPurchaseForOwner(
    purchaseId: string,
    ownerId: string,
  ): Promise<CardPurchase | null>;
  findPlanForPurchase(
    purchaseId: string,
    ownerId: string,
  ): Promise<CardInstallmentPlan | null>;
  /**
   * In one transaction: claims the idempotency key, forms or locks the
   * target invoices in cycle order and verifies that all are open, that the
   * purchase has no plan and that the settlements already declared on the
   * purchase invoice do not exceed its new obligation. Then writes the plan,
   * its installments, the audit event and the idempotency record. Returns the
   * stored response when an identical request committed first.
   */
  insertAtomically(
    request: IdempotencyRequest,
    invoices: readonly CardInvoice[],
    write: CardInstallmentPlanWrite,
  ): Promise<string>;
}

export class CardPurchaseNotFoundError extends Error {
  public constructor() {
    super('Owned card purchase was not found.');
    this.name = 'CardPurchaseNotFoundError';
  }
}

export class CardPurchaseAlreadyInstalledError extends Error {
  public constructor() {
    super('The card purchase already has an installment plan.');
    this.name = 'CardPurchaseAlreadyInstalledError';
  }
}

export class CardInstallmentInvoiceClosedError extends Error {
  public constructor() {
    super('Every invoice of the installment plan must be open.');
    this.name = 'CardInstallmentInvoiceClosedError';
  }
}

export class CardInstallmentSettledAboveObligationError extends Error {
  public constructor() {
    super(
      'Settlements already declared on the purchase invoice exceed its new obligation.',
    );
    this.name = 'CardInstallmentSettledAboveObligationError';
  }
}

type Prepared = Readonly<{
  card: CreditCard;
  purchase: CardPurchase;
  plan: InstallmentPlan;
  cycles: readonly CardCycle[];
  holidayDatasetVersion: string;
  timeZone: string;
}>;

/** Shared validation and calculation for preview and confirmation. */
async function prepare(
  query: CardInstallmentPlanQuery,
  cards: CreditCardRepository,
  plans: CardInstallmentPlanRepository,
  resolver: CardCycleResolver,
): Promise<Prepared> {
  const rate =
    query.rate === null || query.rate === undefined
      ? null
      : InterestRate.create(query.rate);
  const card = await cards.findByIdForOwner(query.cardId, query.actorId);
  if (card === null) throw new CreditCardNotFoundError();
  const purchase = await plans.findPurchaseForOwner(
    query.purchaseId,
    query.actorId,
  );
  if (purchase?.cardId !== card.id) {
    throw new CardPurchaseNotFoundError();
  }
  const plan = calculateInstallmentPlan({
    count: query.count,
    principal: purchase.amount,
    rate,
  });
  const resolved = await resolver.resolve(
    card,
    purchase.toSnapshot().occurredAt,
  );
  const window = resolved.followingCycles(INVOICE_ROUTING_CYCLES + query.count);
  const start = window.findIndex((cycle) =>
    cycle.closesOn.equals(purchase.cycleClosesOn),
  );
  if (start < 0) throw new CardInstallmentInvoiceClosedError();
  const cycles = window.slice(start, start + query.count);
  return {
    card,
    cycles,
    holidayDatasetVersion: resolved.holidayDatasetVersion,
    plan,
    purchase,
    timeZone: resolved.timeZone,
  };
}

/** RN-021 preview: principal, interest, total and schedule; writes nothing. */
export class PreviewCardInstallmentPlanUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly plans: CardInstallmentPlanRepository,
    private readonly cycles: CardCycleResolver,
  ) {}

  public async execute(
    query: CardInstallmentPlanQuery,
  ): Promise<CardInstallmentPlanPreview> {
    const prepared = await prepare(query, this.cards, this.plans, this.cycles);
    return { cycles: prepared.cycles, plan: prepared.plan };
  }
}

/**
 * Splits a purchase already recorded with the card into installments
 * (US-044, ADR-042). Only the installment of each cycle composes that
 * invoice; later ones stay projected until their cycle. Idempotent.
 */
export class RegisterCardInstallmentPlanUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly plans: CardInstallmentPlanRepository,
    private readonly cycles: CardCycleResolver,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: RegisterCardInstallmentPlanCommand,
  ): Promise<CardInstallmentPlan> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.clock.now();
    const rate =
      command.rate === null || command.rate === undefined
        ? null
        : InterestRate.create(command.rate).toSnapshot();
    const request: IdempotencyRequest = {
      key,
      operation: REGISTER_CARD_INSTALLMENT_PLAN_OPERATION,
      ownerId: command.actorId,
      payload: {
        cardId: command.cardId.toLowerCase(),
        count: command.count,
        purchaseId: command.purchaseId.toLowerCase(),
        rateMethod: rate?.method ?? null,
        ratePercentPerPeriod: rate?.percentPerPeriod ?? null,
        ratePeriodicity: rate?.periodicity ?? null,
      },
      requestedAt: at,
    };
    const replayed = await this.plans.findIdempotentResponse(request);
    if (replayed !== null) return parseCardInstallmentPlanResponse(replayed);

    const prepared = await prepare(
      command,
      this.cards,
      this.plans,
      this.cycles,
    );
    if (
      (await this.plans.findPlanForPurchase(
        prepared.purchase.id,
        command.actorId,
      )) !== null
    ) {
      throw new CardPurchaseAlreadyInstalledError();
    }
    const { card, purchase } = prepared;
    const currency = purchase.amount.currency;
    const invoices = prepared.cycles.map((cycle) =>
      CardInvoice.form({
        cardId: card.id,
        closingBoundary: card.toSnapshot().closingBoundary,
        createdAt: at,
        currency,
        cycle,
        holidayDatasetVersion: prepared.holidayDatasetVersion,
        id: this.identifiers.generate(),
        ownerId: command.actorId,
        timeZone: prepared.timeZone,
      }),
    );
    const plan = CardInstallmentPlan.create({
      cardId: card.id,
      createdAt: at,
      cycles: prepared.cycles.map((cycle) => cycle.closesOn),
      id: this.identifiers.generate(),
      installmentIds: prepared.cycles.map(() => this.identifiers.generate()),
      ownerId: command.actorId,
      plan: prepared.plan,
      purchaseId: purchase.id,
    });
    const auditEvent = FinancialAuditEvent.create({
      action: 'created',
      actorId: command.actorId,
      id: this.identifiers.generate(),
      occurredAt: at,
      ownerId: command.actorId,
      resourceId: plan.id,
      resourceType: 'card-installment-plan',
    });
    const stored = await this.plans.insertAtomically(request, invoices, {
      auditEvent,
      plan,
      response: serializeCardInstallmentPlanResponse(plan),
    });
    return parseCardInstallmentPlanResponse(stored);
  }
}

/** Plan of a purchase, or null when it is paid in a single invoice. */
export class GetCardInstallmentPlanUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly plans: CardInstallmentPlanRepository,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; cardId: string; purchaseId: string }>,
  ): Promise<CardInstallmentPlan | null> {
    const card = await this.cards.findByIdForOwner(query.cardId, query.actorId);
    if (card === null) throw new CreditCardNotFoundError();
    const purchase = await this.plans.findPurchaseForOwner(
      query.purchaseId,
      query.actorId,
    );
    if (purchase?.cardId !== card.id) {
      throw new CardPurchaseNotFoundError();
    }
    return this.plans.findPlanForPurchase(purchase.id, query.actorId);
  }
}

export function serializeCardInstallmentPlanResponse(
  plan: CardInstallmentPlan,
): string {
  return JSON.stringify(plan.toSnapshot());
}

export function parseCardInstallmentPlanResponse(
  response: string,
): CardInstallmentPlan {
  const snapshot = JSON.parse(response, (key: string, value: unknown) =>
    key === 'createdAt' && typeof value === 'string' ? new Date(value) : value,
  ) as CardInstallmentPlanSnapshot;
  return CardInstallmentPlan.restore(snapshot);
}
