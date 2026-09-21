import type { Money, MoneySnapshot } from '../money/money.js';
import {
  Transaction,
  type TransactionSnapshot,
} from '../transactions/transaction.js';

export type CreateBalanceAdjustmentProperties = Readonly<{
  accountId: string;
  createdAt: Date;
  id: string;
  justification: string;
  occurredAt: Date;
  ownerId: string;
  previousBalance: Money;
  reportedBalance: Money;
  transactionId: string;
}>;

export type BalanceAdjustmentSnapshot = Readonly<{
  difference: MoneySnapshot;
  id: string;
  justification: string;
  ownerId: string;
  previousBalance: MoneySnapshot;
  reportedBalance: MoneySnapshot;
  transaction: TransactionSnapshot;
}>;

export class InvalidBalanceAdjustmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidBalanceAdjustmentError';
  }
}

export class BalanceAdjustment {
  private constructor(
    public readonly id: string,
    public readonly ownerId: string,
    private readonly previousBalance: Money,
    private readonly reportedBalance: Money,
    private readonly justification: string,
    private readonly transaction: Transaction,
  ) {}

  public static create(
    properties: CreateBalanceAdjustmentProperties,
  ): BalanceAdjustment {
    assertRequiredText(properties.id, 'Adjustment id');
    assertRequiredText(properties.ownerId, 'Adjustment owner id');
    assertRequiredText(properties.justification, 'Adjustment justification');
    if (
      !properties.previousBalance.currency.equals(
        properties.reportedBalance.currency,
      )
    ) {
      throw new InvalidBalanceAdjustmentError(
        'Adjustment balances must use the same currency.',
      );
    }
    const difference = properties.reportedBalance.subtract(
      properties.previousBalance,
    );
    if (difference.isZero()) {
      throw new InvalidBalanceAdjustmentError(
        'Adjustment requires a non-zero balance difference.',
      );
    }
    const amount = moneyFromAbsoluteDifference(difference);
    return new BalanceAdjustment(
      properties.id,
      properties.ownerId,
      properties.previousBalance,
      properties.reportedBalance,
      properties.justification.trim(),
      Transaction.create({
        accountId: properties.accountId,
        amount,
        createdAt: properties.createdAt,
        description: 'Balance reconciliation adjustment',
        id: properties.transactionId,
        kind: difference.toMinorUnits() > 0n ? 'income' : 'expense',
        observations: properties.justification,
        occurredAt: properties.occurredAt,
        ownerId: properties.ownerId,
      }),
    );
  }

  public toSnapshot(): BalanceAdjustmentSnapshot {
    return {
      difference: this.reportedBalance
        .subtract(this.previousBalance)
        .toSnapshot(),
      id: this.id,
      justification: this.justification,
      ownerId: this.ownerId,
      previousBalance: this.previousBalance.toSnapshot(),
      reportedBalance: this.reportedBalance.toSnapshot(),
      transaction: this.transaction.toSnapshot(),
    };
  }
}

function moneyFromAbsoluteDifference(difference: Money): Money {
  return difference.toMinorUnits() < 0n ? difference.negate() : difference;
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidBalanceAdjustmentError(`${label} is required.`);
  }
}
