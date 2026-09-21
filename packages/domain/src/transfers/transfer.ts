import type { Money } from '../money/money.js';
import {
  Transaction,
  type TransactionSnapshot,
} from '../transactions/transaction.js';

export type CreateTransferProperties = Readonly<{
  amount: Money;
  createdAt: Date;
  description: string | null;
  destinationAccountId: string;
  destinationTransactionId: string;
  id: string;
  observations: string | null;
  occurredAt: Date;
  ownerId: string;
  sourceAccountId: string;
  sourceTransactionId: string;
}>;

export type TransferSnapshot = Readonly<{
  destination: TransactionSnapshot;
  id: string;
  ownerId: string;
  source: TransactionSnapshot;
}>;

export class InvalidTransferError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidTransferError';
  }
}

export class Transfer {
  private constructor(
    public readonly id: string,
    public readonly ownerId: string,
    private readonly source: Transaction,
    private readonly destination: Transaction,
  ) {}

  public static create(properties: CreateTransferProperties): Transfer {
    assertRequiredText(properties.id, 'Transfer id');
    assertRequiredText(properties.ownerId, 'Transfer owner id');
    if (properties.sourceAccountId === properties.destinationAccountId) {
      throw new InvalidTransferError(
        'Transfer source and destination accounts must differ.',
      );
    }
    if (
      properties.sourceTransactionId === properties.destinationTransactionId
    ) {
      throw new InvalidTransferError(
        'Transfer transaction identifiers must differ.',
      );
    }
    const shared = {
      amount: properties.amount,
      createdAt: properties.createdAt,
      description: properties.description,
      observations: properties.observations,
      occurredAt: properties.occurredAt,
      ownerId: properties.ownerId,
    };
    return new Transfer(
      properties.id,
      properties.ownerId,
      Transaction.create({
        ...shared,
        accountId: properties.sourceAccountId,
        id: properties.sourceTransactionId,
        kind: 'expense',
      }),
      Transaction.create({
        ...shared,
        accountId: properties.destinationAccountId,
        id: properties.destinationTransactionId,
        kind: 'income',
      }),
    );
  }

  public toSnapshot(): TransferSnapshot {
    return {
      destination: this.destination.toSnapshot(),
      id: this.id,
      ownerId: this.ownerId,
      source: this.source.toSnapshot(),
    };
  }

  public netBalanceEffect(): Money {
    return this.source.balanceEffect().add(this.destination.balanceEffect());
  }
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidTransferError(`${label} is required.`);
  }
}
