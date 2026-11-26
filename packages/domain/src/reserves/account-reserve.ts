import { Money, type MoneySnapshot } from '../money/money.js';

export type AccountReserveSnapshot = Readonly<{
  accountId: string;
  ownerId: string;
  amount: MoneySnapshot;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}>;

export class InvalidAccountReserveError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidAccountReserveError';
  }
}

/** Creating or raising a reserve above the book balance (RN-071). */
export class AccountReserveExceedsBalanceError extends Error {
  public constructor() {
    super('A reserve cannot be raised above the account balance.');
    this.name = 'AccountReserveExceedsBalanceError';
  }
}

/**
 * The part of an account balance the holder declares as reserve (US-051,
 * ADR-043). It is an organizational label: the book balance and the net
 * worth stay the same, and nothing is moved between accounts (RN-031,
 * INV-012, INV-013). A zero amount means the reserve was removed; the row
 * keeps its version and audit history.
 */
export class AccountReserve {
  private constructor(private state: AccountReserveSnapshot) {}

  public static declare(
    input: Readonly<{
      accountId: string;
      ownerId: string;
      amount: Money;
      balance: Money;
      at: Date;
    }>,
  ): AccountReserve {
    const at = validDate(input.at);
    assertAmount(input.amount, input.balance);
    assertWithinBalance(input.amount, input.balance);
    return new AccountReserve({
      accountId: required(input.accountId, 'accountId').toLowerCase(),
      amount: input.amount.toSnapshot(),
      createdAt: at,
      ownerId: required(input.ownerId, 'ownerId'),
      updatedAt: at,
      version: 1,
    });
  }

  public static restore(snapshot: AccountReserveSnapshot): AccountReserve {
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
      throw new InvalidAccountReserveError(
        'Reserve version must be a positive integer.',
      );
    }
    const amount = Money.restore(snapshot.amount);
    if (amount.compare(zeroOf(amount)) < 0) {
      throw new InvalidAccountReserveError('A reserve cannot be negative.');
    }
    return new AccountReserve({
      accountId: required(snapshot.accountId, 'accountId').toLowerCase(),
      amount: amount.toSnapshot(),
      createdAt: validDate(snapshot.createdAt),
      ownerId: required(snapshot.ownerId, 'ownerId'),
      updatedAt: validDate(snapshot.updatedAt),
      version: snapshot.version,
    });
  }

  public get accountId(): string {
    return this.state.accountId;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get amount(): Money {
    return Money.restore(this.state.amount);
  }

  public get version(): number {
    return this.state.version;
  }

  /**
   * Sets a new reserve amount. Raising it is checked against the current
   * balance; lowering or removing it (zero) is always accepted, even when
   * the reserve stays above a balance that fell after the declaration.
   */
  public change(amount: Money, balance: Money, at: Date): void {
    assertAmount(amount, balance);
    if (amount.equals(this.amount)) {
      throw new InvalidAccountReserveError(
        'The reserve already has this value.',
      );
    }
    if (amount.compare(this.amount) > 0) assertWithinBalance(amount, balance);
    const updatedAt = validDate(at);
    if (updatedAt.getTime() < this.state.updatedAt.getTime()) {
      throw new InvalidAccountReserveError(
        'A reserve change cannot precede the last one.',
      );
    }
    this.state = {
      ...this.state,
      amount: amount.toSnapshot(),
      updatedAt,
      version: this.state.version + 1,
    };
  }

  public toSnapshot(): AccountReserveSnapshot {
    return { ...this.state, amount: { ...this.state.amount } };
  }
}

/** The three amounts the read contract exposes, all in the account currency. */
export type AccountAvailability = Readonly<{
  book: Money;
  reserved: Money;
  available: Money;
  /** The declared reserve is above the current book balance (RN-071). */
  reserveAboveBalance: boolean;
}>;

/**
 * Available = book balance − reserve, in the same currency. The book balance
 * is returned unchanged, so net worth counts it once (INV-012, INV-013). The
 * result can be negative when the balance fell below the reserve.
 */
export function calculateAccountAvailability(
  book: Money,
  reserve: Money | null,
): AccountAvailability {
  const reserved = reserve ?? zeroOf(book);
  if (!reserved.currency.equals(book.currency)) {
    throw new InvalidAccountReserveError(
      'A reserve must use the account currency.',
    );
  }
  return {
    available: book.subtract(reserved),
    book,
    reserveAboveBalance: !reserved.isZero() && reserved.compare(book) > 0,
    reserved,
  };
}

function assertAmount(amount: Money, balance: Money): void {
  if (!amount.currency.equals(balance.currency)) {
    throw new InvalidAccountReserveError(
      'A reserve must use the account currency.',
    );
  }
  if (amount.compare(zeroOf(amount)) < 0) {
    throw new InvalidAccountReserveError('A reserve cannot be negative.');
  }
}

function assertWithinBalance(amount: Money, balance: Money): void {
  if (amount.compare(balance) > 0)
    throw new AccountReserveExceedsBalanceError();
}

function zeroOf(money: Money): Money {
  return Money.fromMinorUnits(0n, money.currency);
}

function required(value: string, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    throw new InvalidAccountReserveError(`Reserve ${field} is required.`);
  }
  return trimmed;
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidAccountReserveError(
      'Reserve instants must be valid dates.',
    );
  }
  return new Date(value.getTime());
}
