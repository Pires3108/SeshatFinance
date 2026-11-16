import { calculateInstallmentPlan } from '../installments/installment-plan.js';
import type { InterestRate } from '../interest/interest-rate.js';
import { Rational } from '../interest/rational.js';
import { Money } from '../money/money.js';

export const LOAN_SCHEDULE_CALCULATION_VERSION = 1;
export const MAX_LOAN_INSTALLMENTS = 420;

/** ADR-042: constant = Price, decreasing = SAC, declared = user amounts. */
export const loanAmortizationProfiles = [
  'constant',
  'decreasing',
  'declared',
] as const;
export type LoanAmortizationProfile = (typeof loanAmortizationProfiles)[number];

export class InvalidLoanScheduleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidLoanScheduleError';
  }
}

export type LoanScheduleInput = Readonly<{
  principal: Money;
  count: number;
  rate: InterestRate | null;
  profile: LoanAmortizationProfile;
  /** Required only for the declared profile, one amount per installment. */
  declaredAmounts?: readonly Money[] | undefined;
}>;

export type LoanScheduleLine = Readonly<{
  number: number;
  amount: bigint;
  principal: bigint;
  interest: bigint;
}>;

export type LoanSchedule = Readonly<{
  total: bigint;
  interest: bigint;
  lines: readonly LoanScheduleLine[];
}>;

/**
 * Loan schedule in minor units (ADR-042), exact rational math:
 * - no rate: principal split by RN-018 for every profile;
 * - constant + simple: RN-020 simple total split in equal installments;
 * - constant + compound (Price): total = HALF_UP(n × PMT) split by RN-018,
 *   interest per installment = HALF_UP(balance × i), the last absorbs;
 * - decreasing (SAC): amortization = principal split by RN-018, interest
 *   per installment = HALF_UP(balance × i);
 * - declared: the user amounts; interest = total − principal, allocated by
 *   cumulative share so no component is negative.
 */
export function calculateLoanSchedule(input: LoanScheduleInput): LoanSchedule {
  const { principal, count, rate, profile } = input;
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_LOAN_INSTALLMENTS
  ) {
    throw new InvalidLoanScheduleError(
      `Loan installment count must be an integer from 1 to ${String(MAX_LOAN_INSTALLMENTS)}.`,
    );
  }
  const principalUnits = principal.toMinorUnits();
  if (principalUnits < BigInt(count)) {
    throw new InvalidLoanScheduleError(
      'Every installment must carry at least one minor unit of principal.',
    );
  }
  if (!(loanAmortizationProfiles as readonly string[]).includes(profile)) {
    throw new InvalidLoanScheduleError('Unknown amortization profile.');
  }
  if (profile === 'declared') return declared(input);
  if (input.declaredAmounts !== undefined) {
    throw new InvalidLoanScheduleError(
      'Declared amounts are accepted only for the declared profile.',
    );
  }
  if (rate === null || rate.isZero()) {
    const shares = principal.split(count);
    return build(
      shares.map((share) => share.toMinorUnits()),
      shares.map(() => 0n),
    );
  }
  const periodic = rate.toFraction();
  if (profile === 'decreasing') {
    const amortizations = principal
      .split(count)
      .map((share) => share.toMinorUnits());
    let balance = principalUnits;
    const interests = amortizations.map((amortization) => {
      const interest = Rational.of(balance).multiply(periodic).roundHalfUp();
      balance -= amortization;
      return interest;
    });
    return build(amortizations, interests);
  }
  if (rate.method === 'simple') {
    const plan = calculateInstallmentPlan({ count, principal, rate });
    return build(
      plan.installments.map((item) => item.principal.toMinorUnits()),
      plan.installments.map((item) => item.interest.toMinorUnits()),
    );
  }
  return price(principal, count, periodic);
}

function price(
  principal: Money,
  count: number,
  periodic: Rational,
): LoanSchedule {
  const principalUnits = principal.toMinorUnits();
  const growth = Rational.one.add(periodic).pow(count);
  const payment = Rational.of(principalUnits)
    .multiply(periodic)
    .multiply(growth)
    .divide(growth.subtract(Rational.one));
  const total = payment.multiply(Rational.of(BigInt(count))).roundHalfUp();
  const amounts = Money.fromMinorUnits(total, principal.currency)
    .split(count)
    .map((share) => share.toMinorUnits());
  // Exact cumulative Price amortization up to installment k is
  // P × ((1+i)^k − 1) / ((1+i)^n − 1); with 1+i = N/D it is the integer
  // ratio P × (N^k × D^(n−k) − D^n) / (N^n − D^n), rounded half up. The
  // target is kept inside the bounds that leave no negative component and
  // close the principal exactly with the last installment.
  const base = Rational.one.add(periodic);
  const numerator = base.numerator;
  const denominator = base.denominator;
  const denominatorPowers = [1n];
  for (let power = 1; power <= count; power += 1) {
    denominatorPowers.push((denominatorPowers[power - 1] ?? 1n) * denominator);
  }
  const denominatorToN = denominatorPowers[count] ?? 1n;
  const divisor = numerator ** BigInt(count) - denominatorToN;
  let numeratorToK = 1n;
  let allocated = 0n;
  let laterAmounts = total;
  const principals = amounts.map((amount, index) => {
    const k = index + 1;
    numeratorToK *= numerator;
    laterAmounts -= amount;
    const target =
      k === count
        ? principalUnits
        : divideHalfUp(
            principalUnits *
              (numeratorToK * (denominatorPowers[count - k] ?? 1n) -
                denominatorToN),
            divisor,
          );
    const lower = max(allocated, principalUnits - laterAmounts);
    const upper = min(allocated + amount, principalUnits);
    const next = min(max(target, lower), upper);
    const part = next - allocated;
    allocated = next;
    return part;
  });
  return build(
    principals,
    amounts.map((amount, index) => amount - (principals[index] ?? 0n)),
  );
}

/** Non-negative dividend over a positive divisor, ties away from zero. */
function divideHalfUp(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  return (dividend % divisor) * 2n >= divisor ? quotient + 1n : quotient;
}

function max(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function declared(input: LoanScheduleInput): LoanSchedule {
  const amounts = input.declaredAmounts;
  if (amounts?.length !== input.count) {
    throw new InvalidLoanScheduleError(
      'The declared profile needs one amount per installment.',
    );
  }
  const units = amounts.map((amount) => {
    if (!amount.currency.equals(input.principal.currency)) {
      throw new InvalidLoanScheduleError(
        'Declared installments must use the loan currency.',
      );
    }
    if (amount.toMinorUnits() <= 0n) {
      throw new InvalidLoanScheduleError(
        'Declared installments must be positive.',
      );
    }
    return amount.toMinorUnits();
  });
  const total = units.reduce((sum, unit) => sum + unit, 0n);
  const interestTotal = total - input.principal.toMinorUnits();
  if (interestTotal < 0n) {
    throw new InvalidLoanScheduleError(
      'Declared installments must add up to at least the principal.',
    );
  }
  let cumulative = 0n;
  let allocated = 0n;
  const interests = units.map((unit, index) => {
    cumulative += unit;
    const upTo =
      index === units.length - 1
        ? interestTotal
        : (interestTotal * cumulative) / total;
    const interest = upTo - allocated;
    allocated = upTo;
    return interest;
  });
  return build(
    units.map((unit, index) => unit - (interests[index] ?? 0n)),
    interests,
  );
}

function build(
  principals: readonly bigint[],
  interests: readonly bigint[],
): LoanSchedule {
  const lines = principals.map((principal, index) => {
    const interest = interests[index] ?? 0n;
    if (principal < 0n || interest < 0n) {
      throw new InvalidLoanScheduleError(
        'Schedule components must not be negative.',
      );
    }
    return {
      amount: principal + interest,
      interest,
      number: index + 1,
      principal,
    };
  });
  return {
    interest: lines.reduce((sum, line) => sum + line.interest, 0n),
    lines,
    total: lines.reduce((sum, line) => sum + line.amount, 0n),
  };
}
