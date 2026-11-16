import type { CivilDate } from '@seshat/domain';
import {
  calculateInstallmentPlan,
  CardInstallmentPlan,
  CardInvoice,
  deriveCardPlanState,
  FinancialAuditEvent,
  InterestRate,
  MAX_INSTALLMENT_COUNT,
  Money,
  type CardCycle,
  type CardPlanChange,
  type CardPlanState,
  type CreditCard,
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
import {
  CardPurchaseNotFoundError,
  type CardInstallmentPlanRepository,
  type CardInstallmentRateInput,
} from './register-card-installment-plan.js';

export const CHANGE_CARD_INSTALLMENT_PLAN_OPERATION =
  'card-installment-plan.change';

/** One plan of a purchase with its append-only changes. */
export type CardPlanRecord = Readonly<{
  plan: CardInstallmentPlan;
  changes: readonly CardPlanChange[];
}>;

export type CardPlanChainView = Readonly<{
  /** Original plan first, each renegotiated plan after the one it replaced. */
  plans: readonly (CardPlanRecord & Readonly<{ state: CardPlanState }>)[];
  referenceCycleClosesOn: string;
}>;

export type CardPlanChangeWrite = Readonly<{
  change: CardPlanChange;
  auditEvents: readonly FinancialAuditEvent[];
  /** New linked plan of a renegotiation, with the invoices it composes. */
  newPlan: Readonly<{
    plan: CardInstallmentPlan;
    invoices: readonly CardInvoice[];
  }> | null;
  response: string;
}>;

export interface CardInstallmentPlanChangeRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  /** Plans of a purchase (root first, then each renegotiation) with changes. */
  findChainForPurchase(
    purchaseId: string,
    ownerId: string,
  ): Promise<readonly CardPlanRecord[]>;
  /**
   * In one transaction: claims the key, forms or locks the reference invoice
   * (and the invoices of a new plan) in cycle order, requires them open, locks
   * the current plan, reloads its changes and lets `build` validate them.
   * Writes the change, the new plan if any, audits and the stored response.
   */
  changeAtomically(
    request: IdempotencyRequest,
    planId: string,
    ownerId: string,
    referenceInvoice: CardInvoice,
    build: (record: CardPlanRecord) => CardPlanChangeWrite,
  ): Promise<string>;
}

export class CardInstallmentPlanNotFoundError extends Error {
  public constructor() {
    super('The card purchase has no installment plan.');
    this.name = 'CardInstallmentPlanNotFoundError';
  }
}

type Context = Readonly<{
  card: CreditCard;
  chain: readonly CardPlanRecord[];
  current: CardPlanRecord;
  reference: CardCycle;
  following: readonly CardCycle[];
  holidayDatasetVersion: string;
  timeZone: string;
}>;

async function context(
  query: Readonly<{ actorId: string; cardId: string; purchaseId: string }>,
  cards: CreditCardRepository,
  plans: Pick<CardInstallmentPlanRepository, 'findPurchaseForOwner'>,
  changes: CardInstallmentPlanChangeRepository,
  resolver: CardCycleResolver,
  clock: Clock,
  horizon = 0,
): Promise<Context> {
  const card = await cards.findByIdForOwner(query.cardId, query.actorId);
  if (card === null) throw new CreditCardNotFoundError();
  const purchase = await plans.findPurchaseForOwner(
    query.purchaseId,
    query.actorId,
  );
  if (purchase?.cardId !== card.id) throw new CardPurchaseNotFoundError();
  const chain = await changes.findChainForPurchase(purchase.id, query.actorId);
  const current = chain.at(-1);
  if (current === undefined) throw new CardInstallmentPlanNotFoundError();
  const resolved = await resolver.resolve(card, clock.now());
  return {
    card,
    chain,
    current,
    following: resolved.followingCycles(horizon + 1).slice(1),
    holidayDatasetVersion: resolved.holidayDatasetVersion,
    reference: resolved.cycle,
    timeZone: resolved.timeZone,
  };
}

function formInvoice(
  ctx: Context,
  cycle: CardCycle,
  ownerId: string,
  id: string,
  at: Date,
): CardInvoice {
  return CardInvoice.form({
    cardId: ctx.card.id,
    closingBoundary: ctx.card.toSnapshot().closingBoundary,
    createdAt: at,
    currency: ctx.current.plan.total.currency,
    cycle,
    holidayDatasetVersion: ctx.holidayDatasetVersion,
    id,
    ownerId,
    timeZone: ctx.timeZone,
  });
}

function audit(
  ownerId: string,
  at: Date,
  id: string,
  planId: string,
  action: 'created' | 'updated',
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId: ownerId,
    id,
    occurredAt: at,
    ownerId,
    resourceId: planId,
    resourceType: 'card-installment-plan',
  });
}

/** All plans of a purchase with their changes and derived situations. */
export class GetCardInstallmentPlanChainUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly plans: Pick<
      CardInstallmentPlanRepository,
      'findPurchaseForOwner'
    >,
    private readonly changes: CardInstallmentPlanChangeRepository,
    private readonly resolver: CardCycleResolver,
    private readonly clock: Clock,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; cardId: string; purchaseId: string }>,
  ): Promise<CardPlanChainView> {
    const ctx = await context(
      query,
      this.cards,
      this.plans,
      this.changes,
      this.resolver,
      this.clock,
    );
    return chainView(ctx.chain, ctx.reference.closesOn);
  }
}

function chainView(
  chain: readonly CardPlanRecord[],
  reference: CivilDate,
): CardPlanChainView {
  return {
    plans: chain.map((record) => ({
      ...record,
      state: deriveCardPlanState(record.plan, record.changes, reference),
    })),
    referenceCycleClosesOn: reference.toString(),
  };
}

type ChangeCommand = Readonly<{
  actorId: string;
  cardId: string;
  purchaseId: string;
  idempotencyKey: string;
}>;

abstract class ChangeUseCase<C extends ChangeCommand> {
  public constructor(
    protected readonly cards: CreditCardRepository,
    protected readonly plans: Pick<
      CardInstallmentPlanRepository,
      'findPurchaseForOwner'
    >,
    protected readonly changes: CardInstallmentPlanChangeRepository,
    protected readonly resolver: CardCycleResolver,
    protected readonly clock: Clock,
    protected readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: C): Promise<CardPlanChainView> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.clock.now();
    const request: IdempotencyRequest = {
      key,
      operation: CHANGE_CARD_INSTALLMENT_PLAN_OPERATION,
      ownerId: command.actorId,
      payload: {
        cardId: command.cardId.toLowerCase(),
        change: JSON.stringify(this.payload(command)),
        purchaseId: command.purchaseId.toLowerCase(),
      },
      requestedAt: at,
    };
    const replayed = await this.changes.findIdempotentResponse(request);
    if (replayed === null) {
      const ctx = await context(
        command,
        this.cards,
        this.plans,
        this.changes,
        this.resolver,
        this.clock,
        MAX_INSTALLMENT_COUNT,
      );
      const reference = formInvoice(
        ctx,
        ctx.reference,
        command.actorId,
        this.identifiers.generate(),
        at,
      );
      const prepared = this.prepare(command, ctx, at);
      await this.changes.changeAtomically(
        request,
        ctx.current.plan.id,
        command.actorId,
        reference,
        (record) => {
          const write = prepared(record);
          deriveCardPlanState(
            record.plan,
            [...record.changes, write.change],
            ctx.reference.closesOn,
          );
          return write;
        },
      );
    }
    const ctx = await context(
      command,
      this.cards,
      this.plans,
      this.changes,
      this.resolver,
      this.clock,
    );
    return chainView(ctx.chain, ctx.reference.closesOn);
  }

  protected abstract payload(command: C): Record<string, unknown>;

  protected abstract prepare(
    command: C,
    ctx: Context,
    at: Date,
  ): (record: CardPlanRecord) => CardPlanChangeWrite;
}

export type PrepayCardInstallmentPlanCommand = ChangeCommand &
  Readonly<{ amount: string; discount: string }>;

/**
 * Declares an early settlement already agreed with the issuer (US-046): the
 * future installments leave their cycles and the declared amount composes
 * the invoice open today; the original schedule stays readable as prepaid.
 */
export class PrepayCardInstallmentPlanUseCase extends ChangeUseCase<PrepayCardInstallmentPlanCommand> {
  protected payload(
    command: PrepayCardInstallmentPlanCommand,
  ): Record<string, unknown> {
    return {
      amount: command.amount,
      discount: command.discount,
      kind: 'prepayment',
    };
  }

  protected prepare(
    command: PrepayCardInstallmentPlanCommand,
    ctx: Context,
    at: Date,
  ): (record: CardPlanRecord) => CardPlanChangeWrite {
    const currency = ctx.current.plan.total.currency;
    const changeId = this.identifiers.generate();
    const auditId = this.identifiers.generate();
    const amount = Money.fromDecimal(command.amount, currency).toSnapshot();
    const discount = Money.fromDecimal(command.discount, currency).toSnapshot();
    return (record) => ({
      auditEvents: [
        audit(command.actorId, at, auditId, record.plan.id, 'updated'),
      ],
      change: {
        amount,
        discount,
        effectiveCycleClosesOn: ctx.reference.closesOn.toString(),
        id: changeId,
        kind: 'prepayment',
        recordedAt: at,
      },
      newPlan: null,
      response: JSON.stringify({ changeId }),
    });
  }
}

export type RenegotiateCardInstallmentPlanCommand = ChangeCommand &
  Readonly<{
    principal: string;
    count: number;
    rate?: CardInstallmentRateInput | null | undefined;
  }>;

/**
 * Registers a renegotiation agreed with the issuer (US-046): the future
 * installments stay readable as renegotiated and a new linked plan, with its
 * own calculation version and audit, starts in the next cycle.
 */
export class RenegotiateCardInstallmentPlanUseCase extends ChangeUseCase<RenegotiateCardInstallmentPlanCommand> {
  protected payload(
    command: RenegotiateCardInstallmentPlanCommand,
  ): Record<string, unknown> {
    return {
      count: command.count,
      kind: 'renegotiation',
      principal: command.principal,
      rate: command.rate ?? null,
    };
  }

  protected prepare(
    command: RenegotiateCardInstallmentPlanCommand,
    ctx: Context,
    at: Date,
  ): (record: CardPlanRecord) => CardPlanChangeWrite {
    const currency = ctx.current.plan.total.currency;
    const calculated = calculateInstallmentPlan({
      count: command.count,
      principal: Money.fromDecimal(command.principal, currency),
      rate:
        command.rate === null || command.rate === undefined
          ? null
          : InterestRate.create(command.rate),
    });
    const cycles = ctx.following.slice(0, command.count);
    const newPlanId = this.identifiers.generate();
    const changeId = this.identifiers.generate();
    const auditIds = [this.identifiers.generate(), this.identifiers.generate()];
    const installmentIds = cycles.map(() => this.identifiers.generate());
    const invoices = cycles.map((cycle) =>
      formInvoice(ctx, cycle, command.actorId, this.identifiers.generate(), at),
    );
    return (record) => {
      const plan = CardInstallmentPlan.create({
        cardId: record.plan.cardId,
        createdAt: at,
        cycles: cycles.map((cycle) => cycle.closesOn),
        id: newPlanId,
        installmentIds,
        ownerId: command.actorId,
        plan: calculated,
        purchaseId: record.plan.purchaseId,
        renegotiatedFromId: record.plan.id,
      });
      return {
        auditEvents: [
          audit(
            command.actorId,
            at,
            auditIds[0] ?? '',
            record.plan.id,
            'updated',
          ),
          audit(command.actorId, at, auditIds[1] ?? '', newPlanId, 'created'),
        ],
        change: {
          effectiveCycleClosesOn: ctx.reference.closesOn.toString(),
          id: changeId,
          kind: 'renegotiation',
          newPlanId,
          recordedAt: at,
        },
        newPlan: { invoices, plan },
        response: JSON.stringify({ changeId, newPlanId }),
      };
    };
  }
}

export type ReverseCardInstallmentPlanChangeCommand = ChangeCommand &
  Readonly<{ changeId: string; reason: string }>;

/** Corrects a declared prepayment by an auditable reversal. */
export class ReverseCardInstallmentPlanChangeUseCase extends ChangeUseCase<ReverseCardInstallmentPlanChangeCommand> {
  protected payload(
    command: ReverseCardInstallmentPlanChangeCommand,
  ): Record<string, unknown> {
    return {
      changeId: command.changeId.toLowerCase(),
      kind: 'reversal',
      reason: command.reason.trim(),
    };
  }

  protected prepare(
    command: ReverseCardInstallmentPlanChangeCommand,
    _ctx: Context,
    at: Date,
  ): (record: CardPlanRecord) => CardPlanChangeWrite {
    const changeId = this.identifiers.generate();
    const auditId = this.identifiers.generate();
    return (record) => ({
      auditEvents: [
        audit(command.actorId, at, auditId, record.plan.id, 'updated'),
      ],
      change: {
        id: changeId,
        kind: 'reversal',
        reason: command.reason.trim(),
        recordedAt: at,
        reversedChangeId: command.changeId.toLowerCase(),
      },
      newPlan: null,
      response: JSON.stringify({ changeId }),
    });
  }
}
