import { CivilDate } from '../calendar/civil-date.js';
import {
  InterestRate,
  type InterestRateSnapshot,
} from '../interest/interest-rate.js';
import {
  calculateInstallmentPlan,
  type InstallmentPlan,
} from '../installments/installment-plan.js';
import { Money, type MoneySnapshot } from '../money/money.js';

export const CARD_INSTALLMENT_PLAN_STATUSES = ['active'] as const;
export type CardInstallmentPlanStatus =
  (typeof CARD_INSTALLMENT_PLAN_STATUSES)[number];

export type CardInstallmentSnapshot = Readonly<{
  id: string;
  number: number;
  amount: MoneySnapshot;
  principal: MoneySnapshot;
  interest: MoneySnapshot;
  /** Closing date (ISO civil) of the cycle whose invoice it composes. */
  cycleClosesOn: string;
}>;

export type CardInstallmentPlanSnapshot = Readonly<{
  id: string;
  ownerId: string;
  cardId: string;
  purchaseId: string;
  calculationVersion: number;
  count: number;
  rate: InterestRateSnapshot | null;
  principal: MoneySnapshot;
  interest: MoneySnapshot;
  total: MoneySnapshot;
  status: CardInstallmentPlanStatus;
  createdAt: Date;
  installments: readonly CardInstallmentSnapshot[];
}>;

export class InvalidCardInstallmentPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCardInstallmentPlanError';
  }
}

/**
 * Installment plan of a purchase already recorded with the card (US-044,
 * ADR-042). The purchase stays the expense; its obligation moves from its own
 * invoice to one installment per consecutive cycle. Parameters and schedule
 * are frozen with the calculation version for audit.
 */
export class CardInstallmentPlan {
  private constructor(private readonly state: CardInstallmentPlanSnapshot) {}

  public static create(
    properties: Readonly<{
      id: string;
      ownerId: string;
      cardId: string;
      purchaseId: string;
      createdAt: Date;
      plan: InstallmentPlan;
      cycles: readonly CivilDate[];
      installmentIds: readonly string[];
    }>,
  ): CardInstallmentPlan {
    const { plan, cycles, installmentIds } = properties;
    for (const [value, label] of [
      [properties.id, 'Installment plan id'],
      [properties.ownerId, 'Owner id'],
      [properties.cardId, 'Card id'],
      [properties.purchaseId, 'Purchase id'],
    ] as const) {
      assertText(value, label);
    }
    if (Number.isNaN(properties.createdAt.getTime())) {
      throw new InvalidCardInstallmentPlanError(
        'Installment plan creation instant must be valid.',
      );
    }
    const count = plan.installments.length;
    if (cycles.length !== count || installmentIds.length !== count) {
      throw new InvalidCardInstallmentPlanError(
        'Every installment needs one cycle and one id.',
      );
    }
    for (let index = 1; index < count; index += 1) {
      const previous = cycles[index - 1];
      const current = cycles[index];
      if (
        previous === undefined ||
        current === undefined ||
        current.compare(previous) <= 0
      ) {
        throw new InvalidCardInstallmentPlanError(
          'Installment cycles must be strictly consecutive.',
        );
      }
    }
    if (new Set(installmentIds).size !== count) {
      throw new InvalidCardInstallmentPlanError(
        'Installment ids must be unique.',
      );
    }
    return new CardInstallmentPlan({
      calculationVersion: plan.memory.calculationVersion,
      cardId: properties.cardId,
      count,
      createdAt: new Date(properties.createdAt),
      id: properties.id,
      installments: plan.installments.map((installment, index) => {
        const id = installmentIds[index] ?? '';
        const cycle = cycles[index];
        assertText(id, 'Installment id');
        if (cycle === undefined) {
          throw new InvalidCardInstallmentPlanError(
            'Every installment needs one cycle.',
          );
        }
        return {
          amount: installment.amount.toSnapshot(),
          cycleClosesOn: cycle.toString(),
          id,
          interest: installment.interest.toSnapshot(),
          number: installment.number,
          principal: installment.principal.toSnapshot(),
        };
      }),
      interest: plan.interest.toSnapshot(),
      ownerId: properties.ownerId,
      principal: plan.principal.toSnapshot(),
      purchaseId: properties.purchaseId,
      rate: plan.memory.rate,
      status: 'active',
      total: plan.total.toSnapshot(),
    });
  }

  /**
   * Restores a persisted plan and recomputes it: a stored schedule that does
   * not match its frozen parameters is rejected instead of trusted.
   */
  public static restore(
    snapshot: CardInstallmentPlanSnapshot,
  ): CardInstallmentPlan {
    const recalculated = calculateInstallmentPlan({
      count: snapshot.count,
      principal: Money.restore(snapshot.principal),
      rate: snapshot.rate === null ? null : InterestRate.restore(snapshot.rate),
    });
    const restored = CardInstallmentPlan.create({
      cardId: snapshot.cardId,
      createdAt: snapshot.createdAt,
      cycles: snapshot.installments.map((item) =>
        CivilDate.parse(item.cycleClosesOn),
      ),
      id: snapshot.id,
      installmentIds: snapshot.installments.map((item) => item.id),
      ownerId: snapshot.ownerId,
      plan: recalculated,
      purchaseId: snapshot.purchaseId,
    });
    const expected = restored.state.installments;
    const matches =
      snapshot.calculationVersion === restored.state.calculationVersion &&
      sameMoney(snapshot.total, restored.state.total) &&
      snapshot.installments.length === expected.length &&
      snapshot.installments.every((item, index) => {
        const other = expected[index];
        return (
          item.number === other?.number &&
          sameMoney(item.amount, other.amount) &&
          sameMoney(item.principal, other.principal) &&
          sameMoney(item.interest, other.interest)
        );
      });
    if (!matches) {
      throw new InvalidCardInstallmentPlanError(
        'Stored installment schedule does not match its parameters.',
      );
    }
    return restored;
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get cardId(): string {
    return this.state.cardId;
  }

  public get purchaseId(): string {
    return this.state.purchaseId;
  }

  public get total(): Money {
    return Money.restore(this.state.total);
  }

  public get firstCycleClosesOn(): CivilDate {
    const first = this.state.installments[0];
    if (first === undefined) {
      throw new InvalidCardInstallmentPlanError('Plan has no installments.');
    }
    return CivilDate.parse(first.cycleClosesOn);
  }

  public toSnapshot(): CardInstallmentPlanSnapshot {
    return structuredClone(this.state);
  }
}

function sameMoney(left: MoneySnapshot, right: MoneySnapshot): boolean {
  return Money.restore(left).equals(Money.restore(right));
}

function assertText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidCardInstallmentPlanError(`${label} is required.`);
  }
}
