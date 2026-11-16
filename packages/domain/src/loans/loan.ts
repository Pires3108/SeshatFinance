import { CivilDate } from '../calendar/civil-date.js';
import {
  nextBusinessDay,
  type HolidayPredicate,
} from '../cards/card-cycle-schedule.js';
import {
  InterestRate,
  type InterestRateSnapshot,
} from '../interest/interest-rate.js';
import { Rational } from '../interest/rational.js';
import { Currency } from '../money/currency.js';
import { Money, type MoneySnapshot } from '../money/money.js';
import {
  calculateLoanSchedule,
  LOAN_SCHEDULE_CALCULATION_VERSION,
  loanAmortizationProfiles,
  type LoanAmortizationProfile,
} from './loan-schedule.js';

export const loanDirections = ['payable', 'receivable'] as const;
export type LoanDirection = (typeof loanDirections)[number];

export const loanBusinessDayRules = ['next-business-day', 'none'] as const;
export type LoanBusinessDayRule = (typeof loanBusinessDayRules)[number];

export const loanAllocationComponents = [
  'fee',
  'interest',
  'principal',
] as const;
export type LoanAllocationComponent = (typeof loanAllocationComponents)[number];
export type LoanAllocationOrder = readonly LoanAllocationComponent[];

/** ADR-042 default: fee → interest → principal. */
export const DEFAULT_LOAN_ALLOCATION_ORDER: LoanAllocationOrder = [
  'fee',
  'interest',
  'principal',
];

export type LoanInstallmentSnapshot = Readonly<{
  number: number;
  scheduledDueOn: string;
  /** Effective due date after the business-day rule; delay starts the day after. */
  dueOn: string;
  amount: MoneySnapshot;
  principal: MoneySnapshot;
  interest: MoneySnapshot;
}>;

export type LoanSnapshot = Readonly<{
  id: string;
  ownerId: string;
  direction: LoanDirection;
  counterpartyId: string | null;
  description: string;
  principal: MoneySnapshot;
  contractedOn: string;
  firstDueOn: string;
  count: number;
  rate: InterestRateSnapshot | null;
  profile: LoanAmortizationProfile;
  declaredAmounts: readonly string[] | null;
  /** Late fee percentage applied once to an overdue installment, or null. */
  lateFeePercent: string | null;
  businessDayRule: LoanBusinessDayRule;
  allocationOrder: LoanAllocationOrder;
  calculationVersion: number;
  renegotiatedFromId: string | null;
  createdAt: Date;
  installments: readonly LoanInstallmentSnapshot[];
}>;

export type CreateLoanProperties = Readonly<{
  id: string;
  ownerId: string;
  direction: LoanDirection;
  counterpartyId?: string | null | undefined;
  description: string;
  principal: Money;
  contractedOn: CivilDate;
  firstDueOn: CivilDate;
  count: number;
  rate: InterestRate | null;
  profile: LoanAmortizationProfile;
  declaredAmounts?: readonly Money[] | undefined;
  lateFeePercent?: string | null | undefined;
  businessDayRule: LoanBusinessDayRule;
  allocationOrder?: LoanAllocationOrder | undefined;
  renegotiatedFromId?: string | null | undefined;
  createdAt: Date;
  isHoliday: HolidayPredicate;
}>;

export class InvalidLoanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidLoanError';
  }
}

const percentPattern = /^\d{1,3}(?:\.\d{1,6})?$/u;
const hundred = Rational.of(100n);

/**
 * A loan to pay or receive, declared by the holder (US-047, ADR-042). The
 * schedule, parameters and effective due dates are frozen; payments,
 * prepayment, renegotiation and reversals are separate append-only events.
 * Nothing here moves money: it records what happened outside Seshat Finance.
 */
export class Loan {
  private constructor(private readonly state: LoanSnapshot) {}

  public static create(properties: CreateLoanProperties): Loan {
    for (const [value, label] of [
      [properties.id, 'Loan id'],
      [properties.ownerId, 'Owner id'],
    ] as const) {
      if (value.trim().length === 0) {
        throw new InvalidLoanError(`${label} is required.`);
      }
    }
    if (!(loanDirections as readonly string[]).includes(properties.direction)) {
      throw new InvalidLoanError(
        'Loan direction must be payable or receivable.',
      );
    }
    if (
      !(loanBusinessDayRules as readonly string[]).includes(
        properties.businessDayRule,
      )
    ) {
      throw new InvalidLoanError('Unknown business-day rule.');
    }
    if (
      !(loanAmortizationProfiles as readonly string[]).includes(
        properties.profile,
      )
    ) {
      throw new InvalidLoanError('Unknown amortization profile.');
    }
    const description = properties.description.trim();
    if (description.length === 0 || description.length > 500) {
      throw new InvalidLoanError(
        'Loan description must have 1 to 500 characters.',
      );
    }
    if (properties.principal.toMinorUnits() <= 0n) {
      throw new InvalidLoanError('Loan principal must be positive.');
    }
    if (properties.firstDueOn.compare(properties.contractedOn) < 0) {
      throw new InvalidLoanError(
        'The first due date cannot precede the contract date.',
      );
    }
    if (Number.isNaN(properties.createdAt.getTime())) {
      throw new InvalidLoanError('Loan creation instant must be valid.');
    }
    const lateFeePercent = normalizeFee(properties.lateFeePercent ?? null);
    const allocationOrder =
      properties.allocationOrder ?? DEFAULT_LOAN_ALLOCATION_ORDER;
    assertAllocationOrder(allocationOrder);
    const schedule = calculateLoanSchedule({
      count: properties.count,
      declaredAmounts: properties.declaredAmounts,
      principal: properties.principal,
      profile: properties.profile,
      rate: properties.rate,
    });
    const currency = properties.principal.currency;
    const configuredDay = properties.firstDueOn.day;
    const installments = schedule.lines.map((line, index) => {
      const scheduled = properties.firstDueOn.addMonthsClamped(
        index,
        configuredDay,
      );
      const effective =
        properties.businessDayRule === 'next-business-day'
          ? nextBusinessDay(scheduled, properties.isHoliday)
          : scheduled;
      return {
        amount: snapshot(line.amount, currency),
        dueOn: effective.toString(),
        interest: snapshot(line.interest, currency),
        number: line.number,
        principal: snapshot(line.principal, currency),
        scheduledDueOn: scheduled.toString(),
      };
    });
    return new Loan({
      allocationOrder: [...allocationOrder],
      businessDayRule: properties.businessDayRule,
      calculationVersion: LOAN_SCHEDULE_CALCULATION_VERSION,
      contractedOn: properties.contractedOn.toString(),
      count: properties.count,
      counterpartyId: properties.counterpartyId ?? null,
      createdAt: new Date(properties.createdAt),
      declaredAmounts:
        properties.declaredAmounts?.map((amount) => amount.toDecimal()) ?? null,
      description,
      direction: properties.direction,
      firstDueOn: properties.firstDueOn.toString(),
      id: properties.id,
      installments,
      lateFeePercent,
      ownerId: properties.ownerId,
      principal: properties.principal.toSnapshot(),
      profile: properties.profile,
      rate: properties.rate?.toSnapshot() ?? null,
      renegotiatedFromId: properties.renegotiatedFromId ?? null,
    });
  }

  /**
   * Restores a stored loan. Amounts are recomputed from the frozen
   * parameters and must match; effective due dates are kept as stored
   * because they depend on the holiday dataset of their creation.
   */
  public static restore(value: LoanSnapshot): Loan {
    const principal = Money.restore(value.principal);
    const dueOn = new Map(
      value.installments.map((item) => [item.scheduledDueOn, item.dueOn]),
    );
    const recomputed = Loan.create({
      allocationOrder: value.allocationOrder,
      businessDayRule: 'none',
      contractedOn: CivilDate.parse(value.contractedOn),
      count: value.count,
      counterpartyId: value.counterpartyId,
      createdAt: value.createdAt,
      declaredAmounts: value.declaredAmounts?.map((amount) =>
        Money.fromDecimal(amount, principal.currency),
      ),
      description: value.description,
      direction: value.direction,
      firstDueOn: CivilDate.parse(value.firstDueOn),
      id: value.id,
      isHoliday: () => false,
      lateFeePercent: value.lateFeePercent,
      ownerId: value.ownerId,
      principal,
      profile: value.profile,
      rate: value.rate === null ? null : InterestRate.restore(value.rate),
      renegotiatedFromId: value.renegotiatedFromId,
    });
    const expected = recomputed.state.installments;
    const matches =
      value.calculationVersion === recomputed.state.calculationVersion &&
      value.installments.length === expected.length &&
      value.installments.every((item, index) => {
        const other = expected[index];
        return (
          item.number === other?.number &&
          item.scheduledDueOn === other.scheduledDueOn &&
          same(item.amount, other.amount) &&
          same(item.principal, other.principal) &&
          same(item.interest, other.interest)
        );
      });
    if (!matches) {
      throw new InvalidLoanError(
        'Stored loan schedule does not match its parameters.',
      );
    }
    return new Loan({
      ...recomputed.state,
      businessDayRule: value.businessDayRule,
      installments: expected.map((item) => ({
        ...item,
        dueOn: dueOn.get(item.scheduledDueOn) ?? item.dueOn,
      })),
    });
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get currency(): Currency {
    return Currency.restore(this.state.principal.currency);
  }

  public get allocationOrder(): LoanAllocationOrder {
    return this.state.allocationOrder;
  }

  /** Late fee as an exact fraction of one, or null when not configured. */
  public get lateFeeFraction(): Rational | null {
    return this.state.lateFeePercent === null
      ? null
      : Rational.fromDecimal(this.state.lateFeePercent).divide(hundred);
  }

  public get installments(): readonly LoanInstallmentSnapshot[] {
    return this.state.installments;
  }

  public toSnapshot(): LoanSnapshot {
    return structuredClone(this.state);
  }
}

export function assertAllocationOrder(order: LoanAllocationOrder): void {
  if (
    order.length !== loanAllocationComponents.length ||
    new Set(order).size !== order.length ||
    !order.every((item) =>
      (loanAllocationComponents as readonly string[]).includes(item),
    )
  ) {
    throw new InvalidLoanError(
      'Allocation order must list fee, interest and principal once each.',
    );
  }
}

function normalizeFee(value: string | null): string | null {
  if (value === null) return null;
  if (!percentPattern.test(value)) {
    throw new InvalidLoanError(
      'Late fee must be a percentage with up to six decimal places.',
    );
  }
  if (Rational.fromDecimal(value).compare(hundred) > 0) {
    throw new InvalidLoanError('Late fee must not exceed 100 percent.');
  }
  return value;
}

function snapshot(units: bigint, currency: Currency): MoneySnapshot {
  return Money.fromMinorUnits(units, currency).toSnapshot();
}

function same(left: MoneySnapshot, right: MoneySnapshot): boolean {
  return Money.restore(left).equals(Money.restore(right));
}
