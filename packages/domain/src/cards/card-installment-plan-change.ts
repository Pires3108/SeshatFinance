import { CivilDate } from '../calendar/civil-date.js';
import { Money, type MoneySnapshot } from '../money/money.js';
import type { CardInstallmentPlan } from './card-installment-plan.js';

type ChangeBase = Readonly<{ id: string; recordedAt: Date }>;

/**
 * Prepayment declared by the holder (US-046): the installments after the
 * effective cycle leave their cycles and the declared amount composes the
 * invoice of the effective cycle; the discount is recorded, never inferred.
 */
export type CardPlanPrepayment = ChangeBase &
  Readonly<{
    kind: 'prepayment';
    effectiveCycleClosesOn: string;
    amount: MoneySnapshot;
    discount: MoneySnapshot;
  }>;

/** The installments after the effective cycle move to a new linked plan. */
export type CardPlanRenegotiation = ChangeBase &
  Readonly<{
    kind: 'renegotiation';
    effectiveCycleClosesOn: string;
    newPlanId: string;
  }>;

/** Correction of a prepayment; a renegotiation is corrected by renegotiating the new plan. */
export type CardPlanReversal = ChangeBase &
  Readonly<{
    kind: 'reversal';
    reversedChangeId: string;
    reason: string;
  }>;

export type CardPlanChange =
  CardPlanPrepayment | CardPlanRenegotiation | CardPlanReversal;

export type CardPlanInstallmentSituation =
  'invoiced' | 'projected' | 'prepaid' | 'renegotiated';

export type CardPlanState = Readonly<{
  status: 'active' | 'prepaid' | 'renegotiated';
  installments: readonly Readonly<{
    number: number;
    cycleClosesOn: string;
    amount: Money;
    situation: CardPlanInstallmentSituation;
  }>[];
  /** Installments still projected after the reference cycle. */
  futureOutstanding: Money;
  reversedChangeIds: readonly string[];
}>;

export class InvalidCardPlanChangeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCardPlanChangeError';
  }
}

export class CardPlanPrepaymentMismatchError extends Error {
  public constructor() {
    super('Prepaid amount plus discount must equal the future installments.');
    this.name = 'CardPlanPrepaymentMismatchError';
  }
}

export class CardPlanClosedError extends Error {
  public constructor() {
    super('The installment plan was already prepaid or renegotiated.');
    this.name = 'CardPlanClosedError';
  }
}

export class CardPlanWithoutFutureInstallmentsError extends Error {
  public constructor() {
    super('There are no future installments after the current invoice.');
    this.name = 'CardPlanWithoutFutureInstallmentsError';
  }
}

/**
 * Derives the situation of every installment from the frozen schedule and
 * the non-reversed changes (ADR-042). `referenceCycle` is the invoice cycle
 * open today: installments up to it are invoiced facts, later ones are
 * projected unless a change removed them from their cycles.
 */
export function deriveCardPlanState(
  plan: CardInstallmentPlan,
  changes: readonly CardPlanChange[],
  referenceCycle: CivilDate,
): CardPlanState {
  const snapshot = plan.toSnapshot();
  const currency = plan.total.currency;
  const reversed = new Set<string>();
  const ids = new Set<string>();
  for (const [index, change] of changes.entries()) {
    if (ids.has(change.id)) {
      throw new InvalidCardPlanChangeError('Plan change ids must be unique.');
    }
    ids.add(change.id);
    if (change.kind !== 'reversal') continue;
    const target = changes.find((item) => item.id === change.reversedChangeId);
    if (
      target === undefined ||
      changes.indexOf(target) > index ||
      target.kind !== 'prepayment'
    ) {
      throw new InvalidCardPlanChangeError(
        'Only an earlier prepayment can be reversed.',
      );
    }
    if (reversed.has(target.id)) {
      throw new InvalidCardPlanChangeError('The change was already reversed.');
    }
    if (change.reason.trim().length === 0) {
      throw new InvalidCardPlanChangeError('A reversal needs a reason.');
    }
    reversed.add(target.id);
  }

  let closing: CardPlanPrepayment | CardPlanRenegotiation | null = null;
  for (const change of changes) {
    if (change.kind === 'reversal' || reversed.has(change.id)) continue;
    if (closing !== null) throw new CardPlanClosedError();
    const effective = CivilDate.parse(change.effectiveCycleClosesOn);
    const future = snapshot.installments.filter(
      (item) => CivilDate.parse(item.cycleClosesOn).compare(effective) > 0,
    );
    if (future.length === 0) throw new CardPlanWithoutFutureInstallmentsError();
    if (change.kind === 'prepayment') {
      const owed = future.reduce(
        (sum, item) => sum + Money.restore(item.amount).toMinorUnits(),
        0n,
      );
      const amount = units(change.amount, currency.code);
      const discount = units(change.discount, currency.code);
      if (amount < 0n || discount < 0n || amount + discount !== owed) {
        throw new CardPlanPrepaymentMismatchError();
      }
    }
    closing = change;
  }

  const closedAfter =
    closing === null ? null : CivilDate.parse(closing.effectiveCycleClosesOn);
  const installments = snapshot.installments.map((item) => {
    const cycle = CivilDate.parse(item.cycleClosesOn);
    let situation: CardPlanInstallmentSituation;
    if (
      closing !== null &&
      closedAfter !== null &&
      cycle.compare(closedAfter) > 0
    ) {
      situation = closing.kind === 'prepayment' ? 'prepaid' : 'renegotiated';
    } else {
      situation = cycle.compare(referenceCycle) > 0 ? 'projected' : 'invoiced';
    }
    return {
      amount: Money.restore(item.amount),
      cycleClosesOn: item.cycleClosesOn,
      number: item.number,
      situation,
    };
  });
  return {
    futureOutstanding: Money.fromMinorUnits(
      installments
        .filter((item) => item.situation === 'projected')
        .reduce((sum, item) => sum + item.amount.toMinorUnits(), 0n),
      currency,
    ),
    installments,
    reversedChangeIds: [...reversed],
    status:
      closing === null
        ? 'active'
        : closing.kind === 'prepayment'
          ? 'prepaid'
          : 'renegotiated',
  };
}

function units(value: MoneySnapshot, currencyCode: string): bigint {
  const money = Money.restore(value);
  if (money.currency.code !== currencyCode) {
    throw new InvalidCardPlanChangeError(
      'Plan changes must use the plan currency.',
    );
  }
  return money.toMinorUnits();
}
