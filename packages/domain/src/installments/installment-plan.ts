import {
  InterestRate,
  type InterestRateSnapshot,
} from '../interest/interest-rate.js';
import { Rational } from '../interest/rational.js';
import { Money, type MoneySnapshot } from '../money/money.js';

/** Bump when any formula or rounding rule of this module changes (ADR-042). */
export const INSTALLMENT_CALCULATION_VERSION = 1;
export const MIN_INSTALLMENT_COUNT = 1;
export const MAX_INSTALLMENT_COUNT = 420;

export class InvalidInstallmentPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidInstallmentPlanError';
  }
}

export type InstallmentPlanInput = Readonly<{
  principal: Money;
  count: number;
  rate: InterestRate | null;
}>;

export type PlannedInstallment = Readonly<{
  number: number;
  amount: Money;
  principal: Money;
  interest: Money;
}>;

export type InstallmentCalculationMemory = Readonly<{
  calculationVersion: number;
  count: number;
  principal: MoneySnapshot;
  rate: InterestRateSnapshot | null;
  rounding: 'half-up-final-total';
  split: 'rn-018-last-receives-residual';
}>;

export type InstallmentPlan = Readonly<{
  principal: Money;
  interest: Money;
  total: Money;
  installments: readonly PlannedInstallment[];
  memory: InstallmentCalculationMemory;
}>;

/**
 * Card installment plan (ADR-042, RN-018 to RN-021):
 * - simple: total = P + P × i × n; compound: total = P × (1 + i)^n;
 * - exact rational math, one HALF_UP rounding of the final total;
 * - total split by RN-018 (earlier shares truncate, last gets the residual);
 * - interest of each installment follows the cumulative share of the total,
 *   so no component is negative and every sum closes exactly.
 */
export function calculateInstallmentPlan(
  input: InstallmentPlanInput,
): InstallmentPlan {
  const { principal, count, rate } = input;
  if (!(principal instanceof Money)) {
    throw new InvalidInstallmentPlanError('Principal must be Money.');
  }
  if (
    !Number.isSafeInteger(count) ||
    count < MIN_INSTALLMENT_COUNT ||
    count > MAX_INSTALLMENT_COUNT
  ) {
    throw new InvalidInstallmentPlanError(
      `Installment count must be an integer from ${String(MIN_INSTALLMENT_COUNT)} to ${String(MAX_INSTALLMENT_COUNT)}.`,
    );
  }
  if (rate !== null && !(rate instanceof InterestRate)) {
    throw new InvalidInstallmentPlanError('Rate must be an InterestRate.');
  }
  const principalUnits = principal.toMinorUnits();
  if (principalUnits <= 0n) {
    throw new InvalidInstallmentPlanError('Principal must be positive.');
  }

  const totalUnits = exactTotal(principalUnits, count, rate).roundHalfUp();
  if (totalUnits / BigInt(count) < 1n) {
    throw new InvalidInstallmentPlanError(
      'Every installment must be at least one minor unit.',
    );
  }

  const currency = principal.currency;
  const total = Money.fromMinorUnits(totalUnits, currency);
  const interestUnits = totalUnits - principalUnits;
  const amounts = total.split(count);

  let cumulativeAmount = 0n;
  let cumulativeInterest = 0n;
  const installments = amounts.map((amount, index): PlannedInstallment => {
    cumulativeAmount += amount.toMinorUnits();
    const interestSoFar =
      index === count - 1
        ? interestUnits
        : (interestUnits * cumulativeAmount) / totalUnits;
    const interest = interestSoFar - cumulativeInterest;
    cumulativeInterest = interestSoFar;
    return {
      amount,
      interest: Money.fromMinorUnits(interest, currency),
      number: index + 1,
      principal: Money.fromMinorUnits(
        amount.toMinorUnits() - interest,
        currency,
      ),
    };
  });

  return {
    installments,
    interest: Money.fromMinorUnits(interestUnits, currency),
    memory: {
      calculationVersion: INSTALLMENT_CALCULATION_VERSION,
      count,
      principal: principal.toSnapshot(),
      rate: rate?.toSnapshot() ?? null,
      rounding: 'half-up-final-total',
      split: 'rn-018-last-receives-residual',
    },
    principal,
    total,
  };
}

function exactTotal(
  principalUnits: bigint,
  count: number,
  rate: InterestRate | null,
): Rational {
  const principal = Rational.of(principalUnits);
  if (rate === null || rate.isZero()) return principal;
  const periodic = rate.toFraction();
  if (rate.method === 'simple') {
    return principal.add(
      principal.multiply(periodic).multiply(Rational.of(BigInt(count))),
    );
  }
  return principal.multiply(Rational.one.add(periodic).pow(count));
}
