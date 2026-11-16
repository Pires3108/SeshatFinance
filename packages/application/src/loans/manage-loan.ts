import {
  CivilDate,
  Currency,
  deriveLoanState,
  FinancialAuditEvent,
  InterestRate,
  Loan,
  Money,
  type LoanAllocationOrder,
  type LoanAmortizationProfile,
  type LoanBusinessDayRule,
  type LoanDirection,
  type LoanEvent,
  type LoanExcessClassification,
  type LoanSnapshot,
  type LoanState,
} from '@seshat/domain';

import {
  resolveHolidayPredicate,
  type HolidaySettingsRepository,
} from '../calendar/holiday-settings.js';
import type { CounterpartyRepository } from '../counterparties/manage-counterparty.js';
import { readCivilDate } from '../ports/civil-date.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { UserProfileRepository } from '../users/update-own-user-profile.js';

export const CREATE_LOAN_OPERATION = 'loan.create';
export const RECORD_LOAN_EVENT_OPERATION = 'loan-event.create';
export const RENEGOTIATE_LOAN_OPERATION = 'loan.renegotiate';

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

export type LoanRecord = Readonly<{
  loan: Loan;
  events: readonly LoanEvent[];
}>;

/** A loan with its events and the state derived for the holder's today. */
export type LoanView = LoanRecord & Readonly<{ state: LoanState }>;

export type LoanEventWrite = Readonly<{
  event: LoanEvent;
  auditEvent: FinancialAuditEvent;
  response: string;
}>;

export type LoanRenegotiationWrite = Readonly<{
  loan: Loan;
  event: LoanEvent;
  auditEvents: readonly FinancialAuditEvent[];
  response: string;
}>;

export interface LoanRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<LoanRecord | null>;
  listForOwner(ownerId: string): Promise<readonly LoanRecord[]>;
  /** Claims the key and writes the loan, its audit and the stored response. */
  insertAtomically(
    request: IdempotencyRequest,
    loan: Loan,
    auditEvent: FinancialAuditEvent,
    response: string,
  ): Promise<string>;
  /**
   * Claims the key, locks the loan, rebuilds it with its events and lets
   * `build` validate the new event against them; then appends it with its
   * audit. Returns null when the loan does not exist for the owner.
   */
  appendEventAtomically(
    request: IdempotencyRequest,
    loanId: string,
    ownerId: string,
    build: (record: LoanRecord) => LoanEventWrite,
  ): Promise<string | null>;
  /** Same as appendEventAtomically, also inserting the new linked loan. */
  renegotiateAtomically(
    request: IdempotencyRequest,
    loanId: string,
    ownerId: string,
    build: (record: LoanRecord) => LoanRenegotiationWrite,
  ): Promise<string | null>;
}

export class LoanNotFoundError extends Error {
  public constructor() {
    super('Owned loan was not found.');
    this.name = 'LoanNotFoundError';
  }
}

export class LoanCounterpartyUnavailableError extends Error {
  public constructor() {
    super('Owned active counterparty was not found.');
    this.name = 'LoanCounterpartyUnavailableError';
  }
}

export type LoanTermsInput = Readonly<{
  description: string;
  principal: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  contractedOn: string;
  firstDueOn: string;
  count: number;
  rate?:
    | Readonly<{
        method: string;
        percentPerPeriod: string;
        periodicity: string;
      }>
    | null
    | undefined;
  profile: LoanAmortizationProfile;
  declaredAmounts?: readonly string[] | null | undefined;
  lateFeePercent?: string | null | undefined;
  businessDayRule: LoanBusinessDayRule;
  allocationOrder?: LoanAllocationOrder | null | undefined;
}>;

export type CreateLoanCommand = LoanTermsInput &
  Readonly<{
    actorId: string;
    direction: LoanDirection;
    counterpartyId?: string | null | undefined;
    idempotencyKey: string;
  }>;

export type LoanEventInput =
  | Readonly<{
      kind: 'payment';
      occurredOn: string;
      amount: string;
      allocationOrder?: LoanAllocationOrder | null | undefined;
      excess?: LoanExcessClassification | null | undefined;
      declaredFee?: string | null | undefined;
    }>
  | Readonly<{
      kind: 'prepayment';
      occurredOn: string;
      amount: string;
      discount: string;
    }>
  | Readonly<{ kind: 'reversal'; reversedEventId: string; reason: string }>;

export type RecordLoanEventCommand = Readonly<{
  actorId: string;
  loanId: string;
  idempotencyKey: string;
  event: LoanEventInput;
}>;

export type RenegotiateLoanCommand = Readonly<{
  actorId: string;
  loanId: string;
  idempotencyKey: string;
  occurredOn: string;
  terms: LoanTermsInput;
}>;

/** Today in the holder's time zone, used to derive overdue situations. */
export class LoanCalendar {
  public constructor(
    private readonly profiles: UserProfileRepository,
    private readonly holidays: HolidaySettingsRepository,
    private readonly clock: Clock,
  ) {}

  public async today(ownerId: string): Promise<CivilDate> {
    const profile = await this.profiles.findById(ownerId);
    return CivilDate.parse(
      readCivilDate(this.clock, profile?.timeZone ?? DEFAULT_TIME_ZONE),
    );
  }

  public holidaysFor(
    ownerId: string,
  ): ReturnType<typeof resolveHolidayPredicate> {
    return resolveHolidayPredicate(this.holidays, ownerId);
  }

  public now(): Date {
    return this.clock.now();
  }
}

/** Records a loan already agreed outside Seshat Finance (US-047). */
export class CreateLoanUseCase {
  public constructor(
    private readonly loans: LoanRepository,
    private readonly counterparties: Pick<
      CounterpartyRepository,
      'findByIdForOwner'
    >,
    private readonly calendar: LoanCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateLoanCommand): Promise<LoanView> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.calendar.now();
    const request: IdempotencyRequest = {
      key,
      operation: CREATE_LOAN_OPERATION,
      ownerId: command.actorId,
      payload: {
        counterpartyId: command.counterpartyId?.toLowerCase() ?? null,
        direction: command.direction,
        terms: JSON.stringify(normalizeTerms(command)),
      },
      requestedAt: at,
    };
    const replayed = await this.loans.findIdempotentResponse(request);
    if (replayed !== null) return this.view(parseLoanResponse(replayed));

    await this.assertCounterparty(
      command.counterpartyId ?? null,
      command.actorId,
    );
    const loan = buildLoan(command, {
      counterpartyId: command.counterpartyId ?? null,
      createdAt: at,
      direction: command.direction,
      id: this.identifiers.generate(),
      isHoliday: await this.calendar.holidaysFor(command.actorId),
      ownerId: command.actorId,
      renegotiatedFromId: null,
    });
    const stored = await this.loans.insertAtomically(
      request,
      loan,
      audit(command.actorId, at, this.identifiers.generate(), loan.id, 'loan'),
      serializeLoanResponse({ events: [], loan }),
    );
    return this.view(parseLoanResponse(stored));
  }

  private async view(record: LoanRecord): Promise<LoanView> {
    return withState(record, await this.calendar.today(record.loan.ownerId));
  }

  private async assertCounterparty(
    counterpartyId: string | null,
    ownerId: string,
  ): Promise<void> {
    if (counterpartyId === null) return;
    const counterparty = await this.counterparties.findByIdForOwner(
      counterpartyId,
      ownerId,
    );
    if (counterparty?.toSnapshot().status !== 'active') {
      throw new LoanCounterpartyUnavailableError();
    }
  }
}

export class ListLoansUseCase {
  public constructor(
    private readonly loans: LoanRepository,
    private readonly calendar: LoanCalendar,
  ) {}

  public async execute(actorId: string): Promise<readonly LoanView[]> {
    const today = await this.calendar.today(actorId);
    return (await this.loans.listForOwner(actorId)).map((record) =>
      withState(record, today),
    );
  }
}

export class GetLoanUseCase {
  public constructor(
    private readonly loans: LoanRepository,
    private readonly calendar: LoanCalendar,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; loanId: string }>,
  ): Promise<LoanView> {
    const record = await this.loans.findByIdForOwner(
      query.loanId,
      query.actorId,
    );
    if (record === null) throw new LoanNotFoundError();
    return withState(record, await this.calendar.today(query.actorId));
  }
}

/**
 * Declares a payment, prepayment or reversal already done outside Seshat
 * Finance. The event is validated against all previous events under the
 * loan lock, so retries and concurrent requests change the balance once.
 */
export class RecordLoanEventUseCase {
  public constructor(
    private readonly loans: LoanRepository,
    private readonly calendar: LoanCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: RecordLoanEventCommand): Promise<LoanView> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.calendar.now();
    const request: IdempotencyRequest = {
      key,
      operation: RECORD_LOAN_EVENT_OPERATION,
      ownerId: command.actorId,
      payload: {
        event: JSON.stringify(normalizeEvent(command.event)),
        loanId: command.loanId.toLowerCase(),
      },
      requestedAt: at,
    };
    const today = await this.calendar.today(command.actorId);
    const replayed = await this.loans.findIdempotentResponse(request);
    if (replayed !== null) return withState(parseLoanResponse(replayed), today);
    if (command.event.kind !== 'reversal') {
      assertNotFuture(command.event.occurredOn, today);
    }

    const eventId = this.identifiers.generate();
    const auditId = this.identifiers.generate();
    const stored = await this.loans.appendEventAtomically(
      request,
      command.loanId,
      command.actorId,
      (record) => {
        const event = buildEvent(command.event, record.loan, eventId, at);
        const events = [...record.events, event];
        deriveLoanState(record.loan, events, today);
        return {
          auditEvent: audit(
            command.actorId,
            at,
            auditId,
            record.loan.id,
            'loan',
            'updated',
          ),
          event,
          response: serializeLoanResponse({ events, loan: record.loan }),
        };
      },
    );
    if (stored === null) throw new LoanNotFoundError();
    return withState(parseLoanResponse(stored), today);
  }
}

/**
 * Registers a renegotiation already agreed outside Seshat Finance: the
 * current contract is kept as renegotiated and a new linked loan is created
 * with the declared terms, in one transaction.
 */
export class RenegotiateLoanUseCase {
  public constructor(
    private readonly loans: LoanRepository,
    private readonly calendar: LoanCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: RenegotiateLoanCommand): Promise<LoanView> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.calendar.now();
    const request: IdempotencyRequest = {
      key,
      operation: RENEGOTIATE_LOAN_OPERATION,
      ownerId: command.actorId,
      payload: {
        loanId: command.loanId.toLowerCase(),
        occurredOn: CivilDate.parse(command.occurredOn).toString(),
        terms: JSON.stringify(normalizeTerms(command.terms)),
      },
      requestedAt: at,
    };
    const today = await this.calendar.today(command.actorId);
    const replayed = await this.loans.findIdempotentResponse(request);
    if (replayed !== null) return withState(parseLoanResponse(replayed), today);
    assertNotFuture(command.occurredOn, today);

    const isHoliday = await this.calendar.holidaysFor(command.actorId);
    const newLoanId = this.identifiers.generate();
    const eventId = this.identifiers.generate();
    const auditIds = [this.identifiers.generate(), this.identifiers.generate()];
    const stored = await this.loans.renegotiateAtomically(
      request,
      command.loanId,
      command.actorId,
      (record) => {
        const previous = record.loan.toSnapshot();
        const loan = buildLoan(command.terms, {
          counterpartyId: previous.counterpartyId,
          createdAt: at,
          direction: previous.direction,
          id: newLoanId,
          isHoliday,
          ownerId: command.actorId,
          renegotiatedFromId: record.loan.id,
        });
        const event: LoanEvent = {
          id: eventId,
          kind: 'renegotiation',
          newLoanId,
          occurredOn: CivilDate.parse(command.occurredOn).toString(),
          recordedAt: at,
        };
        const events = [...record.events, event];
        deriveLoanState(record.loan, events, today);
        return {
          auditEvents: [
            audit(
              command.actorId,
              at,
              auditIds[0] ?? '',
              record.loan.id,
              'loan',
              'updated',
            ),
            audit(command.actorId, at, auditIds[1] ?? '', loan.id, 'loan'),
          ],
          event,
          loan,
          response: serializeLoanResponse({ events: [], loan }),
        };
      },
    );
    if (stored === null) throw new LoanNotFoundError();
    return withState(parseLoanResponse(stored), today);
  }
}

export function withState(record: LoanRecord, today: CivilDate): LoanView {
  return {
    ...record,
    state: deriveLoanState(record.loan, record.events, today),
  };
}

export class LoanEventInFutureError extends Error {
  public constructor() {
    super('A declared loan event cannot happen after today.');
    this.name = 'LoanEventInFutureError';
  }
}

function assertNotFuture(occurredOn: string, today: CivilDate): void {
  if (CivilDate.parse(occurredOn).compare(today) > 0) {
    throw new LoanEventInFutureError();
  }
}

function normalizeEvent(input: LoanEventInput): Record<string, unknown> {
  if (input.kind === 'reversal') {
    return {
      kind: input.kind,
      reason: input.reason.trim(),
      reversedEventId: input.reversedEventId.toLowerCase(),
    };
  }
  if (input.kind === 'prepayment') {
    return {
      amount: input.amount,
      discount: input.discount,
      kind: input.kind,
      occurredOn: input.occurredOn,
    };
  }
  return {
    allocationOrder: input.allocationOrder ?? null,
    amount: input.amount,
    declaredFee: input.declaredFee ?? null,
    excess: input.excess ?? null,
    kind: input.kind,
    occurredOn: input.occurredOn,
  };
}

function normalizeTerms(terms: LoanTermsInput): Record<string, unknown> {
  return {
    allocationOrder: terms.allocationOrder ?? null,
    businessDayRule: terms.businessDayRule,
    contractedOn: terms.contractedOn,
    count: terms.count,
    currencyCode: terms.currencyCode,
    currencyMinorUnitScale: terms.currencyMinorUnitScale,
    declaredAmounts: terms.declaredAmounts ?? null,
    description: terms.description.trim(),
    firstDueOn: terms.firstDueOn,
    lateFeePercent: terms.lateFeePercent ?? null,
    principal: terms.principal,
    profile: terms.profile,
    rate: terms.rate ?? null,
  };
}

function buildLoan(
  terms: LoanTermsInput,
  identity: Readonly<{
    id: string;
    ownerId: string;
    direction: LoanDirection;
    counterpartyId: string | null;
    renegotiatedFromId: string | null;
    createdAt: Date;
    isHoliday: (date: CivilDate) => boolean;
  }>,
): Loan {
  const currency = Currency.create(
    terms.currencyCode,
    terms.currencyMinorUnitScale,
  );
  return Loan.create({
    ...identity,
    allocationOrder: terms.allocationOrder ?? undefined,
    businessDayRule: terms.businessDayRule,
    contractedOn: CivilDate.parse(terms.contractedOn),
    count: terms.count,
    declaredAmounts: terms.declaredAmounts?.map((amount) =>
      Money.fromDecimal(amount, currency),
    ),
    description: terms.description,
    firstDueOn: CivilDate.parse(terms.firstDueOn),
    lateFeePercent: terms.lateFeePercent ?? null,
    principal: Money.fromDecimal(terms.principal, currency),
    profile: terms.profile,
    rate:
      terms.rate === null || terms.rate === undefined
        ? null
        : InterestRate.create(terms.rate),
  });
}

function buildEvent(
  input: LoanEventInput,
  loan: Loan,
  id: string,
  recordedAt: Date,
): LoanEvent {
  const currency = loan.currency;
  const money = (value: string): Money => Money.fromDecimal(value, currency);
  if (input.kind === 'reversal') {
    return {
      id,
      kind: 'reversal',
      reason: input.reason.trim(),
      recordedAt,
      reversedEventId: input.reversedEventId.toLowerCase(),
    };
  }
  const occurredOn = CivilDate.parse(input.occurredOn).toString();
  if (input.kind === 'prepayment') {
    return {
      amount: money(input.amount).toSnapshot(),
      discount: money(input.discount).toSnapshot(),
      id,
      kind: 'prepayment',
      occurredOn,
      recordedAt,
    };
  }
  return {
    allocationOrder: input.allocationOrder ?? null,
    amount: money(input.amount).toSnapshot(),
    declaredFee:
      input.declaredFee === null || input.declaredFee === undefined
        ? null
        : money(input.declaredFee).toSnapshot(),
    excess: input.excess ?? null,
    id,
    kind: 'payment',
    occurredOn,
    recordedAt,
  };
}

function audit(
  actorId: string,
  occurredAt: Date,
  id: string,
  resourceId: string,
  resourceType: 'loan',
  action: 'created' | 'updated' = 'created',
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId,
    id,
    occurredAt,
    ownerId: actorId,
    resourceId,
    resourceType,
  });
}

type SerializedRecord = Readonly<{
  loan: LoanSnapshot;
  events: readonly LoanEvent[];
}>;

/** Serializes the record exactly as written, for idempotent replay. */
export function serializeLoanResponse(record: LoanRecord): string {
  return JSON.stringify({
    events: record.events,
    loan: record.loan.toSnapshot(),
  });
}

const dateKeys = new Set(['createdAt', 'recordedAt']);

export function parseLoanResponse(response: string): LoanRecord {
  const parsed = JSON.parse(response, (key: string, value: unknown) =>
    dateKeys.has(key) && typeof value === 'string' ? new Date(value) : value,
  ) as SerializedRecord;
  return { events: parsed.events, loan: Loan.restore(parsed.loan) };
}
