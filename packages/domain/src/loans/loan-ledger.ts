import { CivilDate } from '../calendar/civil-date.js';
import { Rational } from '../interest/rational.js';
import { Money, type MoneySnapshot } from '../money/money.js';
import {
  assertAllocationOrder,
  type Loan,
  type LoanAllocationComponent,
  type LoanAllocationOrder,
} from './loan.js';

export const loanExcessClassifications = [
  'extra-amortization',
  'receivable-credit',
] as const;
export type LoanExcessClassification =
  (typeof loanExcessClassifications)[number];

type EventBase = Readonly<{ id: string; recordedAt: Date }>;

export type LoanPaymentEvent = EventBase &
  Readonly<{
    kind: 'payment';
    occurredOn: string;
    amount: MoneySnapshot;
    /** Overrides the loan allocation order for this payment only. */
    allocationOrder: LoanAllocationOrder | null;
    /** Required when the amount exceeds the eligible obligation. */
    excess: LoanExcessClassification | null;
    /** Effective fee declared for the oldest overdue installment. */
    declaredFee: MoneySnapshot | null;
  }>;

export type LoanPrepaymentEvent = EventBase &
  Readonly<{
    kind: 'prepayment';
    occurredOn: string;
    amount: MoneySnapshot;
    discount: MoneySnapshot;
  }>;

export type LoanRenegotiationEvent = EventBase &
  Readonly<{
    kind: 'renegotiation';
    occurredOn: string;
    newLoanId: string;
  }>;

export type LoanReversalEvent = EventBase &
  Readonly<{
    kind: 'reversal';
    reversedEventId: string;
    reason: string;
  }>;

export type LoanEvent =
  | LoanPaymentEvent
  | LoanPrepaymentEvent
  | LoanRenegotiationEvent
  | LoanReversalEvent;

export type LoanStatus = 'active' | 'settled' | 'renegotiated';
export type LoanInstallmentSituation =
  'paid' | 'prepaid' | 'renegotiated' | 'overdue' | 'partial' | 'open';

export type LoanInstallmentState = Readonly<{
  number: number;
  dueOn: string;
  amount: Money;
  /** Fee estimated from the loan configuration once it became overdue. */
  estimatedFee: Money | null;
  /** Fee declared by the holder; it prevails over the estimate. */
  declaredFee: Money | null;
  paid: Money;
  /** Allocation of what was paid, per component (ADR-042 order). */
  paidFee: Money;
  paidInterest: Money;
  paidPrincipal: Money;
  remaining: Money;
  situation: LoanInstallmentSituation;
}>;

export type LoanState = Readonly<{
  status: LoanStatus;
  /** Outstanding organizational balance; negative when credit exceeds it. */
  pending: Money;
  credit: Money;
  paidTotal: Money;
  installments: readonly LoanInstallmentState[];
  reversedEventIds: readonly string[];
}>;

export class InvalidLoanEventError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidLoanEventError';
  }
}

export class LoanPaymentExcessUnclassifiedError extends Error {
  public constructor() {
    super(
      'The declared amount exceeds the eligible obligation; classify the excess.',
    );
    this.name = 'LoanPaymentExcessUnclassifiedError';
  }
}

export class LoanExcessBeyondContractError extends Error {
  public constructor() {
    super(
      'The excess is larger than the whole contract; classify it as a receivable credit.',
    );
    this.name = 'LoanExcessBeyondContractError';
  }
}

export class LoanPrepaymentMismatchError extends Error {
  public constructor() {
    super('Prepaid amount plus discount must equal the pending balance.');
    this.name = 'LoanPrepaymentMismatchError';
  }
}

export class LoanClosedError extends Error {
  public constructor() {
    super('The loan is already settled or renegotiated.');
    this.name = 'LoanClosedError';
  }
}

interface Working {
  number: number;
  dueOn: CivilDate;
  amount: bigint;
  interest: bigint;
  principal: bigint;
  paidFee: bigint;
  paidInterest: bigint;
  paidPrincipal: bigint;
  fee: bigint | null;
  estimatedFee: bigint | null;
  declaredFee: bigint | null;
  closedBy: 'prepaid' | 'renegotiated' | null;
}

/**
 * Replays the non-reversed events in order and derives the loan state as of
 * `today` (ADR-042, INV-048): each event changes the pending balance exactly
 * once and reversals restore it without deleting history.
 */
export function deriveLoanState(
  loan: Loan,
  events: readonly LoanEvent[],
  today: CivilDate,
): LoanState {
  const currency = loan.currency;
  const money = (units: bigint): Money => Money.fromMinorUnits(units, currency);
  const reversed = new Set<string>();
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.id)) {
      throw new InvalidLoanEventError('Loan event ids must be unique.');
    }
    ids.add(event.id);
    if (event.kind === 'reversal') {
      const target = events.find((item) => item.id === event.reversedEventId);
      if (
        target === undefined ||
        events.indexOf(target) > events.indexOf(event) ||
        (target.kind !== 'payment' && target.kind !== 'prepayment')
      ) {
        throw new InvalidLoanEventError(
          'Only an earlier payment or prepayment can be reversed.',
        );
      }
      if (reversed.has(target.id)) {
        throw new InvalidLoanEventError('The event was already reversed.');
      }
      if (event.reason.trim().length === 0) {
        throw new InvalidLoanEventError('A reversal needs a reason.');
      }
      reversed.add(target.id);
    }
  }

  const items: Working[] = loan.installments.map((item) => ({
    amount: units(item.amount),
    closedBy: null,
    declaredFee: null,
    dueOn: CivilDate.parse(item.dueOn),
    estimatedFee: null,
    fee: null,
    interest: units(item.interest),
    number: item.number,
    paidFee: 0n,
    paidInterest: 0n,
    paidPrincipal: 0n,
    principal: units(item.principal),
  }));
  let credit = 0n;
  let paidTotal = 0n;
  let status: LoanStatus = 'active';

  for (const event of events) {
    if (event.kind === 'reversal' || reversed.has(event.id)) continue;
    if (status !== 'active') throw new LoanClosedError();
    const on = CivilDate.parse(event.occurredOn);
    fixFees(items, loan, on);
    if (event.kind === 'renegotiation') {
      for (const item of items) {
        if (open(item) > 0n) item.closedBy = 'renegotiated';
      }
      status = 'renegotiated';
      continue;
    }
    if (event.kind === 'prepayment') {
      const pending =
        items.reduce((sum, item) => sum + open(item), 0n) - credit;
      const amount = eventUnits(event.amount, loan);
      const discount = eventUnits(event.discount, loan);
      if (amount < 0n || discount < 0n || amount + discount !== pending) {
        throw new LoanPrepaymentMismatchError();
      }
      for (const item of items) {
        if (open(item) > 0n) item.closedBy = 'prepaid';
      }
      paidTotal += amount;
      credit = 0n;
      status = 'settled';
      continue;
    }
    const amount = eventUnits(event.amount, loan);
    if (amount <= 0n) {
      throw new InvalidLoanEventError('A payment must be positive.');
    }
    const order = event.allocationOrder ?? loan.allocationOrder;
    assertAllocationOrder(order);
    if (event.declaredFee !== null) {
      const target = items.find(
        (item) =>
          item.closedBy === null &&
          item.dueOn.compare(on) < 0 &&
          open(item) > 0n,
      );
      if (target === undefined) {
        throw new InvalidLoanEventError(
          'A declared fee needs an overdue installment.',
        );
      }
      target.declaredFee = eventUnits(event.declaredFee, loan);
      target.fee = target.declaredFee;
    }
    let remaining = amount;
    const eligible = items.filter(
      (item) => item.closedBy === null && item.dueOn.compare(on) <= 0,
    );
    remaining = allocate(eligible, order, remaining);
    if (remaining > 0n) {
      if (event.excess === null) throw new LoanPaymentExcessUnclassifiedError();
      if (event.excess === 'extra-amortization') {
        const future = items.filter(
          (item) => item.closedBy === null && item.dueOn.compare(on) > 0,
        );
        remaining = allocate(future, order, remaining);
        if (remaining > 0n) throw new LoanExcessBeyondContractError();
      } else {
        credit += remaining;
      }
    }
    paidTotal += amount;
    if (items.every((item) => open(item) === 0n) && credit === 0n) {
      status = 'settled';
    }
  }

  if (status === 'active') fixFees(items, loan, today);
  const pending =
    status === 'active'
      ? items.reduce((sum, item) => sum + open(item), 0n) - credit
      : 0n;
  return {
    credit: money(status === 'active' ? credit : 0n),
    installments: items.map((item) => {
      const paid = item.paidFee + item.paidInterest + item.paidPrincipal;
      const left = item.closedBy === null ? open(item) : 0n;
      return {
        amount: money(item.amount),
        declaredFee: item.declaredFee === null ? null : money(item.declaredFee),
        dueOn: item.dueOn.toString(),
        estimatedFee:
          item.estimatedFee === null ? null : money(item.estimatedFee),
        number: item.number,
        paid: money(paid),
        paidFee: money(item.paidFee),
        paidInterest: money(item.paidInterest),
        paidPrincipal: money(item.paidPrincipal),
        remaining: money(left),
        situation: situation(item, left, paid, today),
      };
    }),
    paidTotal: money(paidTotal),
    pending: money(pending),
    reversedEventIds: [...reversed],
    status,
  };
}

/** Fee is fixed once per installment still open after its effective due date. */
function fixFees(items: Working[], loan: Loan, on: CivilDate): void {
  const fraction = loan.lateFeeFraction;
  for (const item of items) {
    if (
      item.closedBy !== null ||
      item.fee !== null ||
      item.dueOn.compare(on) >= 0 ||
      scheduleOpen(item) === 0n
    ) {
      continue;
    }
    const estimate =
      fraction === null
        ? 0n
        : Rational.of(item.amount).multiply(fraction).roundHalfUp();
    item.estimatedFee = fraction === null ? null : estimate;
    item.fee = estimate;
  }
}

function allocate(
  items: readonly Working[],
  order: readonly LoanAllocationComponent[],
  amount: bigint,
): bigint {
  let remaining = amount;
  for (const item of items) {
    for (const component of order) {
      if (remaining === 0n) return 0n;
      const due = componentOpen(item, component);
      const pay = due < remaining ? due : remaining;
      if (pay === 0n) continue;
      if (component === 'fee') item.paidFee += pay;
      else if (component === 'interest') item.paidInterest += pay;
      else item.paidPrincipal += pay;
      remaining -= pay;
    }
  }
  return remaining;
}

function componentOpen(
  item: Working,
  component: LoanAllocationComponent,
): bigint {
  if (component === 'fee') return (item.fee ?? 0n) - item.paidFee;
  if (component === 'interest') return item.interest - item.paidInterest;
  return item.principal - item.paidPrincipal;
}

function scheduleOpen(item: Working): bigint {
  return (
    item.interest - item.paidInterest + (item.principal - item.paidPrincipal)
  );
}

function open(item: Working): bigint {
  if (item.closedBy !== null) return 0n;
  return scheduleOpen(item) + (item.fee ?? 0n) - item.paidFee;
}

function situation(
  item: Working,
  left: bigint,
  paid: bigint,
  today: CivilDate,
): LoanInstallmentSituation {
  if (item.closedBy !== null) return item.closedBy;
  if (left === 0n) return 'paid';
  if (item.dueOn.compare(today) < 0) return 'overdue';
  return paid > 0n ? 'partial' : 'open';
}

function units(value: MoneySnapshot): bigint {
  return Money.restore(value).toMinorUnits();
}

function eventUnits(value: MoneySnapshot, loan: Loan): bigint {
  const amount = Money.restore(value);
  if (!amount.currency.equals(loan.currency)) {
    throw new InvalidLoanEventError('Loan events must use the loan currency.');
  }
  return amount.toMinorUnits();
}
