import { Money, type MoneySnapshot } from '../money/money.js';

export type TransactionKind = 'income' | 'expense';
export type TransactionLifecycle = 'active' | 'archived' | 'trashed';

export type TransactionSnapshot = Readonly<{
  accountId: string;
  amount: MoneySnapshot;
  archivedAt: Date | null;
  createdAt: Date;
  description: string | null;
  id: string;
  kind: TransactionKind;
  lifecycle: TransactionLifecycle;
  occurredAt: Date;
  ownerId: string;
  trashedAt: Date | null;
  updatedAt: Date;
  version: number;
}>;

export type CreateTransactionProperties = Readonly<{
  accountId: string;
  amount: Money;
  createdAt: Date;
  description: string | null;
  id: string;
  kind: TransactionKind;
  occurredAt: Date;
  ownerId: string;
}>;

export type UpdateTransactionDetails = Readonly<{
  amount: Money;
  description: string | null;
  kind: TransactionKind;
  occurredAt: Date;
}>;

export class InvalidTransactionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionError';
  }
}

export class TransactionLifecycleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TransactionLifecycleError';
  }
}

export class Transaction {
  private constructor(private state: TransactionSnapshot) {}

  public static create(properties: CreateTransactionProperties): Transaction {
    assertRequiredText(properties.id, 'Transaction id');
    assertRequiredText(properties.ownerId, 'Transaction owner id');
    assertRequiredText(properties.accountId, 'Transaction account id');
    assertValidInstant(properties.createdAt, 'Transaction creation instant');
    assertValidInstant(properties.occurredAt, 'Transaction occurrence instant');
    assertPositiveAmount(properties.amount);
    return new Transaction({
      accountId: properties.accountId,
      amount: properties.amount.toSnapshot(),
      archivedAt: null,
      createdAt: new Date(properties.createdAt),
      description: normalizeOptionalText(properties.description),
      id: properties.id,
      kind: properties.kind,
      lifecycle: 'active',
      occurredAt: new Date(properties.occurredAt),
      ownerId: properties.ownerId,
      trashedAt: null,
      updatedAt: new Date(properties.createdAt),
      version: 1,
    });
  }

  public static restore(snapshot: TransactionSnapshot): Transaction {
    validateSnapshot(snapshot);
    return new Transaction(copySnapshot(snapshot));
  }

  public get amount(): Money {
    return Money.restore(this.state.amount);
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get accountId(): string {
    return this.state.accountId;
  }

  public get lifecycle(): TransactionLifecycle {
    return this.state.lifecycle;
  }

  public balanceEffect(): Money {
    const amount = this.amount;
    if (this.state.lifecycle === 'trashed') {
      return Money.fromMinorUnits(0n, amount.currency);
    }
    return this.state.kind === 'income' ? amount : amount.negate();
  }

  public archive(at: Date): void {
    this.requireLifecycle(
      'active',
      'Only an active transaction can be archived.',
    );
    this.transition('archived', at, { archivedAt: at, trashedAt: null });
  }

  public unarchive(at: Date): void {
    this.requireLifecycle(
      'archived',
      'Only an archived transaction can be unarchived.',
    );
    this.transition('active', at, { archivedAt: null, trashedAt: null });
  }

  public updateDetails(details: UpdateTransactionDetails, at: Date): void {
    this.requireNotTrashed();
    assertPositiveAmount(details.amount);
    assertValidInstant(details.occurredAt, 'Transaction occurrence instant');
    if (!details.amount.currency.equals(this.amount.currency)) {
      throw new InvalidTransactionError('Transaction currency cannot change.');
    }
    this.state = {
      ...this.state,
      amount: details.amount.toSnapshot(),
      description: normalizeOptionalText(details.description),
      kind: details.kind,
      occurredAt: new Date(details.occurredAt),
      updatedAt: checkedTransitionInstant(at, this.state.updatedAt),
      version: this.state.version + 1,
    };
  }

  public moveToTrash(at: Date): void {
    if (this.state.lifecycle === 'trashed') {
      throw new TransactionLifecycleError(
        'Transaction is already in the trash.',
      );
    }
    this.transition('trashed', at, {
      archivedAt: this.state.archivedAt,
      trashedAt: at,
    });
  }

  public restoreFromTrash(at: Date): void {
    this.requireLifecycle(
      'trashed',
      'Only a trashed transaction can be restored.',
    );
    this.transition(
      this.state.archivedAt === null ? 'active' : 'archived',
      at,
      {
        archivedAt: this.state.archivedAt,
        trashedAt: null,
      },
    );
  }

  public toSnapshot(): TransactionSnapshot {
    return copySnapshot(this.state);
  }

  private requireLifecycle(
    expected: TransactionLifecycle,
    message: string,
  ): void {
    if (this.state.lifecycle !== expected) {
      throw new TransactionLifecycleError(message);
    }
  }

  private requireNotTrashed(): void {
    if (this.state.lifecycle === 'trashed') {
      throw new TransactionLifecycleError(
        'A trashed transaction cannot be edited.',
      );
    }
  }

  private transition(
    lifecycle: TransactionLifecycle,
    at: Date,
    timestamps: Pick<TransactionSnapshot, 'archivedAt' | 'trashedAt'>,
  ): void {
    this.state = {
      ...this.state,
      ...timestamps,
      lifecycle,
      updatedAt: checkedTransitionInstant(at, this.state.updatedAt),
      version: this.state.version + 1,
    };
  }
}

function checkedTransitionInstant(at: Date, previous: Date): Date {
  assertValidInstant(at, 'Transaction transition instant');
  if (at < previous) {
    throw new TransactionLifecycleError(
      'Transaction transition cannot precede the previous update.',
    );
  }
  return new Date(at);
}

export function calculateAccountBalance(
  initialBalance: Money,
  transactions: readonly Transaction[],
): Money {
  return transactions.reduce(
    (balance, transaction) => balance.add(transaction.balanceEffect()),
    initialBalance,
  );
}

function validateSnapshot(snapshot: TransactionSnapshot): void {
  assertRequiredText(snapshot.id, 'Transaction id');
  assertRequiredText(snapshot.ownerId, 'Transaction owner id');
  assertRequiredText(snapshot.accountId, 'Transaction account id');
  assertValidInstant(snapshot.createdAt, 'Transaction creation instant');
  assertValidInstant(snapshot.occurredAt, 'Transaction occurrence instant');
  assertValidInstant(snapshot.updatedAt, 'Transaction update instant');
  assertOptionalInstant(snapshot.archivedAt, 'Transaction archive instant');
  assertOptionalInstant(snapshot.trashedAt, 'Transaction trash instant');
  assertPositiveAmount(Money.restore(snapshot.amount));
  if (!['active', 'archived', 'trashed'].includes(snapshot.lifecycle)) {
    throw new InvalidTransactionError('Transaction lifecycle is invalid.');
  }
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
    throw new InvalidTransactionError(
      'Transaction version must be a positive integer.',
    );
  }
  if (snapshot.updatedAt < snapshot.createdAt) {
    throw new InvalidTransactionError(
      'Transaction update cannot precede creation.',
    );
  }
  if (
    (snapshot.archivedAt !== null &&
      snapshot.archivedAt < snapshot.createdAt) ||
    (snapshot.trashedAt !== null && snapshot.trashedAt < snapshot.createdAt)
  ) {
    throw new InvalidTransactionError(
      'Transaction lifecycle instants cannot precede creation.',
    );
  }
  if (snapshot.lifecycle === 'active' && snapshot.archivedAt !== null) {
    throw new InvalidTransactionError(
      'An active transaction cannot have an archive instant.',
    );
  }
  if (snapshot.lifecycle === 'archived' && snapshot.archivedAt === null) {
    throw new InvalidTransactionError(
      'An archived transaction requires an archive instant.',
    );
  }
  if (snapshot.lifecycle === 'trashed' && snapshot.trashedAt === null) {
    throw new InvalidTransactionError(
      'A trashed transaction requires a trash instant.',
    );
  }
  if (snapshot.lifecycle !== 'trashed' && snapshot.trashedAt !== null) {
    throw new InvalidTransactionError(
      'Only a trashed transaction can have a trash instant.',
    );
  }
}

function assertPositiveAmount(amount: Money): void {
  if (amount.toMinorUnits() <= 0n) {
    throw new InvalidTransactionError('Transaction amount must be positive.');
  }
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidTransactionError(`${label} is required.`);
  }
}

function assertValidInstant(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidTransactionError(`${label} must be valid.`);
  }
}

function assertOptionalInstant(value: Date | null, label: string): void {
  if (value !== null) assertValidInstant(value, label);
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}

function copySnapshot(snapshot: TransactionSnapshot): TransactionSnapshot {
  return {
    ...snapshot,
    amount: {
      amount: snapshot.amount.amount,
      currency: { ...snapshot.amount.currency },
    },
    archivedAt:
      snapshot.archivedAt === null ? null : new Date(snapshot.archivedAt),
    createdAt: new Date(snapshot.createdAt),
    occurredAt: new Date(snapshot.occurredAt),
    trashedAt:
      snapshot.trashedAt === null ? null : new Date(snapshot.trashedAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}
