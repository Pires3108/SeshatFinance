import {
  FinancialAuditEvent,
  InvestmentEvent,
  Money,
  Transaction,
  investmentEventAccountEffect,
  type FinancialAuditAction,
  type InvestmentEventKind,
  type InvestmentEventSnapshot,
} from '@seshat/domain';

import type { AccountRepository } from '../accounts/create-account.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import {
  InvestmentNotFoundError,
  type InvestmentRepository,
} from './manage-investment.js';

export const RECORD_INVESTMENT_EVENT_OPERATION = 'investment-event.create';

/** Everything written for one event, in one database transaction. */
export type InvestmentEventWrite = Readonly<{
  event: InvestmentEvent;
  /** Linked account entry; null without an account or for fees and taxes. */
  transaction: Transaction | null;
  auditEvents: readonly FinancialAuditEvent[];
}>;

export interface InvestmentEventRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  findByIdForOwner(
    eventId: string,
    ownerId: string,
  ): Promise<InvestmentEvent | null>;
  listForInvestment(
    investmentId: string,
    ownerId: string,
  ): Promise<readonly InvestmentEvent[]>;
  /**
   * In one transaction: claims the key, locks the investment, rechecks that
   * it is active, writes the account entry, the event, the audit and the
   * response, then rejects the whole write with
   * InvestmentCustodyExceededError when the custody would become negative.
   */
  recordAtomically(
    request: IdempotencyRequest,
    write: InvestmentEventWrite,
    response: string,
  ): Promise<string>;
  /**
   * Locks the investment and the event, checks the version, applies the
   * change to the event and its linked entry and rechecks the custody.
   * Returns null when the event is not owned.
   */
  changeAtomically(
    eventId: string,
    ownerId: string,
    expectedVersion: number,
    build: (
      event: InvestmentEvent,
      transaction: Transaction | null,
    ) => InvestmentEventWrite,
  ): Promise<InvestmentEvent | null>;
}

export class InvestmentEventNotFoundError extends Error {
  public constructor() {
    super('Owned investment event was not found.');
    this.name = 'InvestmentEventNotFoundError';
  }
}

export class InvestmentEventVersionConflictError extends Error {
  public constructor() {
    super('The investment event was changed by another request.');
    this.name = 'InvestmentEventVersionConflictError';
  }
}

export class InvestmentUnavailableForEventError extends Error {
  public constructor() {
    super('Events are recorded only on an active investment.');
    this.name = 'InvestmentUnavailableForEventError';
  }
}

export class InvestmentEventAccountUnavailableError extends Error {
  public constructor() {
    super('Owned active account was not found.');
    this.name = 'InvestmentEventAccountUnavailableError';
  }
}

export class InvestmentEventCurrencyMismatchError extends Error {
  public constructor() {
    super('The account and the investment must share one currency.');
    this.name = 'InvestmentEventCurrencyMismatchError';
  }
}

/** A resgate above the quantity in custody is rejected (RN-073). */
export class InvestmentCustodyExceededError extends Error {
  public constructor() {
    super('The quantity in custody cannot become negative.');
    this.name = 'InvestmentCustodyExceededError';
  }
}

export type RecordInvestmentEventCommand = Readonly<{
  actorId: string;
  investmentId: string;
  kind: InvestmentEventKind;
  amount: string;
  quantity?: string | null | undefined;
  unitPrice?: string | null | undefined;
  occurredAt: Date;
  timeZone: string;
  accountId?: string | null | undefined;
  note?: string | null | undefined;
  idempotencyKey: string;
}>;

const entryDescriptions: Readonly<Record<InvestmentEventKind, string>> = {
  contribution: 'Aporte em',
  redemption: 'Resgate de',
  yield: 'Rendimento de',
  dividend: 'Dividendo de',
  interest: 'Juros de',
  fee: 'Taxa de',
  tax: 'Imposto de',
};

/**
 * Records a declared investment event (US-055, ADR-044). With an account, an
 * aporte or resgate writes a linked account entry that changes the book
 * balance but is neither income nor expense; an income writes a linked
 * income. Nothing is executed outside Seshat Finance.
 */
export class RecordInvestmentEventUseCase {
  public constructor(
    private readonly investments: Pick<
      InvestmentRepository,
      'findByIdForOwner'
    >,
    private readonly accounts: Pick<AccountRepository, 'findByIdForOwner'>,
    private readonly events: InvestmentEventRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: RecordInvestmentEventCommand,
  ): Promise<InvestmentEvent> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.clock.now();
    const accountId = command.accountId?.toLowerCase() ?? null;
    const request: IdempotencyRequest = {
      key,
      operation: RECORD_INVESTMENT_EVENT_OPERATION,
      ownerId: command.actorId,
      payload: {
        accountId,
        amount: command.amount,
        investmentId: command.investmentId.toLowerCase(),
        kind: command.kind,
        note: command.note ?? null,
        occurredAt: command.occurredAt.toISOString(),
        quantity: command.quantity ?? null,
        timeZone: command.timeZone,
        unitPrice: command.unitPrice ?? null,
      },
      requestedAt: at,
    };
    const replayed = await this.events.findIdempotentResponse(request);
    if (replayed !== null) return parseInvestmentEventResponse(replayed);

    const investment = await this.investments.findByIdForOwner(
      command.investmentId,
      command.actorId,
    );
    if (investment === null) throw new InvestmentNotFoundError();
    if (investment.lifecycle !== 'active') {
      throw new InvestmentUnavailableForEventError();
    }
    const amount = Money.fromDecimal(command.amount, investment.currency);
    const effect = investmentEventAccountEffect(command.kind);
    let transaction: Transaction | null = null;
    if (accountId !== null && effect !== null) {
      const account = await this.accounts.findByIdForOwner(
        accountId,
        command.actorId,
      );
      if (account?.lifecycle !== 'active') {
        throw new InvestmentEventAccountUnavailableError();
      }
      if (!account.initialBalance.currency.equals(investment.currency)) {
        throw new InvestmentEventCurrencyMismatchError();
      }
      transaction = Transaction.create({
        accountId: account.id,
        amount,
        createdAt: at,
        description: `${entryDescriptions[command.kind]} ${investment.toSnapshot().name}`,
        id: this.identifiers.generate(),
        kind: effect,
        occurredAt: command.occurredAt,
        ownerId: command.actorId,
      });
    }
    const event = InvestmentEvent.create({
      accountId,
      amount,
      createdAt: at,
      id: this.identifiers.generate(),
      investment,
      kind: command.kind,
      note: command.note ?? null,
      occurredAt: command.occurredAt,
      quantity: command.quantity ?? null,
      timeZone: command.timeZone,
      transactionId: transaction?.id ?? null,
      unitPrice: command.unitPrice ?? null,
    });
    const auditEvents = [
      ...(transaction === null
        ? []
        : [
            this.audit(
              command.actorId,
              at,
              transaction.id,
              'transaction',
              'created',
            ),
          ]),
      this.audit(command.actorId, at, event.id, 'investment-event', 'created'),
    ];
    const stored = await this.events.recordAtomically(
      request,
      { auditEvents, event, transaction },
      serializeInvestmentEventResponse(event),
    );
    return parseInvestmentEventResponse(stored);
  }

  private audit(
    actorId: string,
    at: Date,
    resourceId: string,
    resourceType: 'transaction' | 'investment-event',
    action: FinancialAuditAction,
  ): FinancialAuditEvent {
    return FinancialAuditEvent.create({
      action,
      actorId,
      id: this.identifiers.generate(),
      occurredAt: at,
      ownerId: actorId,
      resourceId,
      resourceType,
    });
  }
}

export class ListInvestmentEventsUseCase {
  public constructor(
    private readonly investments: Pick<
      InvestmentRepository,
      'findByIdForOwner'
    >,
    private readonly events: Pick<
      InvestmentEventRepository,
      'listForInvestment'
    >,
  ) {}

  public async execute(
    command: Readonly<{ actorId: string; investmentId: string }>,
  ): Promise<readonly InvestmentEvent[]> {
    const investment = await this.investments.findByIdForOwner(
      command.investmentId,
      command.actorId,
    );
    if (investment === null) throw new InvestmentNotFoundError();
    return this.events.listForInvestment(investment.id, command.actorId);
  }
}

export type InvestmentEventLifecycleAction = 'trash' | 'restore';

/**
 * Moves an event and its linked account entry to the trash or back together
 * (ADR-044). A trashed event stops counting; restoring it counts again.
 */
export class ChangeInvestmentEventLifecycleUseCase {
  public constructor(
    private readonly events: Pick<
      InvestmentEventRepository,
      'changeAtomically'
    >,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: Readonly<{
      actorId: string;
      eventId: string;
      expectedVersion: number;
      action: InvestmentEventLifecycleAction;
    }>,
  ): Promise<InvestmentEvent> {
    const at = this.clock.now();
    const action: FinancialAuditAction =
      command.action === 'trash' ? 'moved-to-trash' : 'restored-from-trash';
    const changed = await this.events.changeAtomically(
      command.eventId,
      command.actorId,
      command.expectedVersion,
      (event, transaction) => {
        if (command.action === 'trash') {
          event.trash(at);
          transaction?.moveToTrash(at);
        } else {
          event.restoreFromTrash(at);
          transaction?.restoreFromTrash(at);
        }
        const audit = (
          resourceId: string,
          resourceType: 'transaction' | 'investment-event',
        ): FinancialAuditEvent =>
          FinancialAuditEvent.create({
            action,
            actorId: command.actorId,
            id: this.identifiers.generate(),
            occurredAt: at,
            ownerId: command.actorId,
            resourceId,
            resourceType,
          });
        return {
          auditEvents: [
            ...(transaction === null
              ? []
              : [audit(transaction.id, 'transaction')]),
            audit(event.id, 'investment-event'),
          ],
          event,
          transaction,
        };
      },
    );
    if (changed === null) throw new InvestmentEventNotFoundError();
    return changed;
  }
}

const dateFields = new Set(['createdAt', 'occurredAt', 'updatedAt']);

export function serializeInvestmentEventResponse(
  event: InvestmentEvent,
): string {
  return JSON.stringify(event.toSnapshot());
}

export function parseInvestmentEventResponse(
  response: string,
): InvestmentEvent {
  const snapshot = JSON.parse(response, (key: string, value: unknown) =>
    dateFields.has(key) && typeof value === 'string' ? new Date(value) : value,
  ) as InvestmentEventSnapshot;
  return InvestmentEvent.restore(snapshot);
}
