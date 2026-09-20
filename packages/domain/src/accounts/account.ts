import { AccountType, type AccountTypeSnapshot } from './account-type.js';
import { Money, type MoneySnapshot } from '../money/money.js';

export type AccountLifecycle = 'active' | 'archived' | 'trashed';

export type AccountSnapshot = Readonly<{
  archivedAt: Date | null;
  color: string | null;
  createdAt: Date;
  description: string | null;
  icon: string | null;
  id: string;
  initialBalance: MoneySnapshot;
  institution: string | null;
  lifecycle: AccountLifecycle;
  name: string;
  ownerId: string;
  trashedAt: Date | null;
  type: AccountTypeSnapshot;
  updatedAt: Date;
  version: number;
}>;

export type CreateAccountProperties = Readonly<{
  color: string | null;
  createdAt: Date;
  description: string | null;
  icon: string | null;
  id: string;
  initialBalance: Money;
  institution: string | null;
  name: string;
  ownerId: string;
  type: AccountType;
}>;

export class InvalidAccountError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidAccountError';
  }
}

export class AccountLifecycleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AccountLifecycleError';
  }
}

export class Account {
  private constructor(private state: AccountSnapshot) {}

  public static create(properties: CreateAccountProperties): Account {
    assertRequiredText(properties.id, 'Account id');
    assertRequiredText(properties.ownerId, 'Account owner id');
    assertRequiredText(properties.name, 'Account name');
    assertValidInstant(properties.createdAt, 'Account creation instant');

    return new Account({
      archivedAt: null,
      color: normalizeOptionalText(properties.color),
      createdAt: new Date(properties.createdAt),
      description: normalizeOptionalText(properties.description),
      icon: normalizeOptionalText(properties.icon),
      id: properties.id,
      initialBalance: properties.initialBalance.toSnapshot(),
      institution: normalizeOptionalText(properties.institution),
      lifecycle: 'active',
      name: properties.name.trim(),
      ownerId: properties.ownerId,
      trashedAt: null,
      type: properties.type.toSnapshot(),
      updatedAt: new Date(properties.createdAt),
      version: 1,
    });
  }

  public static restore(snapshot: AccountSnapshot): Account {
    validateSnapshot(snapshot);
    return new Account(copySnapshot(snapshot));
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get lifecycle(): AccountLifecycle {
    return this.state.lifecycle;
  }

  public get initialBalance(): Money {
    return Money.restore(this.state.initialBalance);
  }

  public archive(at: Date): void {
    this.requireLifecycle('active', 'Only an active account can be archived.');
    this.transition('archived', at, { archivedAt: at, trashedAt: null });
  }

  public unarchive(at: Date): void {
    this.requireLifecycle(
      'archived',
      'Only an archived account can be unarchived.',
    );
    this.transition('active', at, { archivedAt: null, trashedAt: null });
  }

  public moveToTrash(at: Date): void {
    if (this.state.lifecycle === 'trashed') {
      throw new AccountLifecycleError('Account is already in the trash.');
    }
    this.transition('trashed', at, {
      archivedAt: this.state.archivedAt,
      trashedAt: at,
    });
  }

  public restoreFromTrash(at: Date): void {
    this.requireLifecycle('trashed', 'Only a trashed account can be restored.');
    const lifecycle: AccountLifecycle =
      this.state.archivedAt === null ? 'active' : 'archived';
    this.transition(lifecycle, at, {
      archivedAt: this.state.archivedAt,
      trashedAt: null,
    });
  }

  public rename(name: string, at: Date): void {
    assertRequiredText(name, 'Account name');
    this.requireNotTrashed();
    this.state = {
      ...this.state,
      name: name.trim(),
      updatedAt: checkedTransitionInstant(at, this.state.updatedAt),
      version: this.state.version + 1,
    };
  }

  public toSnapshot(): AccountSnapshot {
    return copySnapshot(this.state);
  }

  private requireLifecycle(expected: AccountLifecycle, message: string): void {
    if (this.state.lifecycle !== expected) {
      throw new AccountLifecycleError(message);
    }
  }

  private requireNotTrashed(): void {
    if (this.state.lifecycle === 'trashed') {
      throw new AccountLifecycleError('A trashed account cannot be edited.');
    }
  }

  private transition(
    lifecycle: AccountLifecycle,
    at: Date,
    timestamps: Pick<AccountSnapshot, 'archivedAt' | 'trashedAt'>,
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

function validateSnapshot(snapshot: AccountSnapshot): void {
  assertRequiredText(snapshot.id, 'Account id');
  assertRequiredText(snapshot.ownerId, 'Account owner id');
  assertRequiredText(snapshot.name, 'Account name');
  assertValidInstant(snapshot.createdAt, 'Account creation instant');
  assertValidInstant(snapshot.updatedAt, 'Account update instant');
  assertOptionalInstant(snapshot.archivedAt, 'Account archive instant');
  assertOptionalInstant(snapshot.trashedAt, 'Account trash instant');
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
    throw new InvalidAccountError(
      'Account version must be a positive integer.',
    );
  }
  if (snapshot.updatedAt < snapshot.createdAt) {
    throw new InvalidAccountError('Account update cannot precede creation.');
  }
  if (
    (snapshot.archivedAt !== null &&
      snapshot.archivedAt < snapshot.createdAt) ||
    (snapshot.trashedAt !== null && snapshot.trashedAt < snapshot.createdAt)
  ) {
    throw new InvalidAccountError(
      'Account lifecycle instants cannot precede creation.',
    );
  }
  AccountType.restore(snapshot.type);
  Money.restore(snapshot.initialBalance);
  if (snapshot.lifecycle === 'active' && snapshot.archivedAt !== null) {
    throw new InvalidAccountError(
      'An active account cannot have an archive instant.',
    );
  }
  if (snapshot.lifecycle === 'archived' && snapshot.archivedAt === null) {
    throw new InvalidAccountError(
      'An archived account requires an archive instant.',
    );
  }
  if (snapshot.lifecycle === 'trashed' && snapshot.trashedAt === null) {
    throw new InvalidAccountError(
      'A trashed account requires a trash instant.',
    );
  }
  if (snapshot.lifecycle !== 'trashed' && snapshot.trashedAt !== null) {
    throw new InvalidAccountError(
      'Only a trashed account can have a trash instant.',
    );
  }
}

function checkedTransitionInstant(at: Date, previous: Date): Date {
  assertValidInstant(at, 'Account transition instant');
  if (at < previous) {
    throw new AccountLifecycleError(
      'Account transition cannot precede the previous update.',
    );
  }
  return new Date(at);
}

function assertRequiredText(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvalidAccountError(`${label} is required.`);
  }
}

function assertValidInstant(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidAccountError(`${label} must be valid.`);
  }
}

function assertOptionalInstant(value: Date | null, label: string): void {
  if (value !== null) assertValidInstant(value, label);
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}

function copySnapshot(snapshot: AccountSnapshot): AccountSnapshot {
  return {
    ...snapshot,
    archivedAt:
      snapshot.archivedAt === null ? null : new Date(snapshot.archivedAt),
    createdAt: new Date(snapshot.createdAt),
    initialBalance: {
      amount: snapshot.initialBalance.amount,
      currency: { ...snapshot.initialBalance.currency },
    },
    trashedAt:
      snapshot.trashedAt === null ? null : new Date(snapshot.trashedAt),
    type: { ...snapshot.type },
    updatedAt: new Date(snapshot.updatedAt),
  };
}
