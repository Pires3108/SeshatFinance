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

  public static restore(snapshot: TransferSnapshot): Transfer {
    assertRequiredText(snapshot.id, 'Transfer id');
    assertRequiredText(snapshot.ownerId, 'Transfer owner id');
    const source = Transaction.restore(snapshot.source);
    const destination = Transaction.restore(snapshot.destination);
    validatePair(snapshot.ownerId, source, destination);
    return new Transfer(snapshot.id, snapshot.ownerId, source, destination);
  }

  public archive(at: Date): void {
    this.changePairLifecycle((transaction) => {
      transaction.archive(at);
    });
  }

  public unarchive(at: Date): void {
    this.changePairLifecycle((transaction) => {
      transaction.unarchive(at);
    });
  }

  public moveToTrash(at: Date): void {
    this.changePairLifecycle((transaction) => {
      transaction.moveToTrash(at);
    });
  }

  public restoreFromTrash(at: Date): void {
    this.changePairLifecycle((transaction) => {
      transaction.restoreFromTrash(at);
    });
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

  private changePairLifecycle(
    change: (transaction: Transaction) => void,
  ): void {
    validatePair(this.ownerId, this.source, this.destination);
    change(this.source);
    change(this.destination);
  }
}

function validatePair(
  ownerId: string,
  source: Transaction,
  destination: Transaction,
): void {
  const sourceSnapshot = source.toSnapshot();
  const destinationSnapshot = destination.toSnapshot();
  if (
    source.ownerId !== ownerId ||
    destination.ownerId !== ownerId ||
    sourceSnapshot.kind !== 'expense' ||
    destinationSnapshot.kind !== 'income' ||
    source.accountId === destination.accountId ||
    source.id === destination.id ||
    !source.amount.equals(destination.amount) ||
    sourceSnapshot.description !== destinationSnapshot.description ||
    sourceSnapshot.observations !== destinationSnapshot.observations ||
    sourceSnapshot.lifecycle !== destinationSnapshot.lifecycle ||
    sourceSnapshot.version !== destinationSnapshot.version ||
    !sameInstant(sourceSnapshot.createdAt, destinationSnapshot.createdAt) ||
    !sameInstant(sourceSnapshot.occurredAt, destinationSnapshot.occurredAt) ||
    !sameInstant(sourceSnapshot.updatedAt, destinationSnapshot.updatedAt) ||
    !sameInstant(sourceSnapshot.archivedAt, destinationSnapshot.archivedAt) ||
    !sameInstant(sourceSnapshot.trashedAt, destinationSnapshot.trashedAt)
  ) {
    throw new InvalidTransferError(
      'Transfer entries must form a coherent pair.',
    );
  }
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidTransferError(`${label} is required.`);
  }
}
