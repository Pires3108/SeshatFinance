import {
  AccountReserve,
  calculateAccountAvailability,
  FinancialAuditEvent,
  Money,
  type Account,
  type AccountAvailability,
  type AccountReserveSnapshot,
  type FinancialAuditAction,
} from '@seshat/domain';

import type { OwnedBalanceSummary } from '../accounts/get-owned-balance-summary.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';

export const SET_ACCOUNT_RESERVE_OPERATION = 'account-reserve.set';

export type AccountReserveWrite = Readonly<{
  reserve: AccountReserve;
  auditEvent: FinancialAuditEvent;
}>;

export interface AccountReserveRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  findForOwner(
    accountId: string,
    ownerId: string,
  ): Promise<AccountReserve | null>;
  listForOwner(ownerId: string): Promise<readonly AccountReserve[]>;
  /**
   * Claims the key, locks the account and its reserve, checks the expected
   * version (0 when no reserve exists yet) and saves what `build` returns,
   * with its audit and the stored response, in one transaction.
   */
  saveAtomically(
    request: IdempotencyRequest,
    accountId: string,
    expectedVersion: number,
    build: (current: AccountReserve | null) => AccountReserveWrite,
    serialize: (reserve: AccountReserve) => string,
  ): Promise<string>;
}

/** Account facts read through the Accounts public use cases. */
export type ReserveAccountView = Readonly<{
  id: string;
  lifecycle: Account['lifecycle'];
  balance: Money;
}>;

export interface ReserveAccountDirectory {
  findOwned(
    accountId: string,
    ownerId: string,
  ): Promise<ReserveAccountView | null>;
}

export class OwnedReserveAccountDirectory implements ReserveAccountDirectory {
  public constructor(
    private readonly accounts: Readonly<{
      execute(accountId: string, actorId: string): Promise<Account | null>;
    }>,
    private readonly balances: Readonly<{
      execute(accountId: string, actorId: string): Promise<Money>;
    }>,
  ) {}

  public async findOwned(
    accountId: string,
    ownerId: string,
  ): Promise<ReserveAccountView | null> {
    const account = await this.accounts.execute(accountId, ownerId);
    if (account === null) return null;
    return {
      balance: await this.balances.execute(account.id, ownerId),
      id: account.id.toLowerCase(),
      lifecycle: account.lifecycle,
    };
  }
}

export class ReserveAccountNotFoundError extends Error {
  public constructor() {
    super('Owned account was not found.');
    this.name = 'ReserveAccountNotFoundError';
  }
}

/** Only an active account accepts a reserve change. */
export class ReserveAccountUnavailableError extends Error {
  public constructor() {
    super('Only an active account accepts a reserve change.');
    this.name = 'ReserveAccountUnavailableError';
  }
}

export class AccountReserveVersionConflictError extends Error {
  public constructor() {
    super('The reserve was changed by another request.');
    this.name = 'AccountReserveVersionConflictError';
  }
}

export type AccountAvailabilityView = Readonly<{
  accountId: string;
  availability: AccountAvailability;
  /** 0 when no reserve was ever declared. */
  reserveVersion: number;
}>;

export type SetAccountReserveCommand = Readonly<{
  actorId: string;
  accountId: string;
  amount: string;
  expectedVersion: number;
  idempotencyKey: string;
}>;

/**
 * Creates, changes or removes (amount zero) the reserve of an account. The
 * book balance and net worth never change (US-051, RN-071, INV-012).
 */
export class SetAccountReserveUseCase {
  public constructor(
    private readonly reserves: AccountReserveRepository,
    private readonly accounts: ReserveAccountDirectory,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: SetAccountReserveCommand,
  ): Promise<AccountAvailabilityView> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.clock.now();
    const accountId = command.accountId.trim().toLowerCase();
    const request: IdempotencyRequest = {
      key,
      operation: SET_ACCOUNT_RESERVE_OPERATION,
      ownerId: command.actorId,
      payload: {
        accountId,
        amount: command.amount.trim(),
        expectedVersion: command.expectedVersion,
      },
      requestedAt: at,
    };
    const owned = await this.accounts.findOwned(accountId, command.actorId);
    if (owned === null) throw new ReserveAccountNotFoundError();
    const replayed = await this.reserves.findIdempotentResponse(request);
    if (replayed !== null) {
      return view(accountId, owned.balance, parseReserveResponse(replayed));
    }
    if (owned.lifecycle !== 'active') {
      throw new ReserveAccountUnavailableError();
    }
    const amount = Money.fromDecimal(
      command.amount.trim(),
      owned.balance.currency,
    );
    const auditId = this.identifiers.generate();
    const stored = await this.reserves.saveAtomically(
      request,
      accountId,
      command.expectedVersion,
      (current) => {
        if ((current?.version ?? 0) !== command.expectedVersion) {
          throw new AccountReserveVersionConflictError();
        }
        const action: FinancialAuditAction =
          current === null ? 'created' : 'updated';
        const reserve =
          current ??
          AccountReserve.declare({
            accountId,
            amount,
            at,
            balance: owned.balance,
            ownerId: command.actorId,
          });
        if (current !== null) current.change(amount, owned.balance, at);
        return {
          auditEvent: FinancialAuditEvent.create({
            action,
            actorId: command.actorId,
            id: auditId,
            occurredAt: at,
            ownerId: command.actorId,
            resourceId: accountId,
            resourceType: 'account-reserve',
          }),
          reserve,
        };
      },
      serializeReserveResponse,
    );
    return view(accountId, owned.balance, parseReserveResponse(stored));
  }
}

/** Book balance, reserve and available amount of one owned account. */
export class GetAccountAvailabilityUseCase {
  public constructor(
    private readonly reserves: Pick<AccountReserveRepository, 'findForOwner'>,
    private readonly accounts: ReserveAccountDirectory,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; accountId: string }>,
  ): Promise<AccountAvailabilityView> {
    const accountId = query.accountId.trim().toLowerCase();
    const owned = await this.accounts.findOwned(accountId, query.actorId);
    if (owned === null) throw new ReserveAccountNotFoundError();
    const reserve = await this.reserves.findForOwner(accountId, query.actorId);
    return view(accountId, owned.balance, reserve);
  }
}

export type CurrencyAvailabilityTotal = Readonly<{
  book: Money;
  reserved: Money;
  available: Money;
}>;

export type OwnedAvailabilitySummary = Readonly<{
  accounts: readonly AccountAvailabilityView[];
  /** One line per currency; currencies are never added together. */
  totalsByCurrency: readonly CurrencyAvailabilityTotal[];
}>;

/**
 * Availability of every account the balance summary counts (active and
 * archived; trashed accounts and their reserves drop out until restored).
 */
export class GetOwnedAvailabilitySummaryUseCase {
  public constructor(
    private readonly reserves: Pick<AccountReserveRepository, 'listForOwner'>,
    private readonly balances: Readonly<{
      execute(actorId: string): Promise<OwnedBalanceSummary>;
    }>,
  ) {}

  public async execute(actorId: string): Promise<OwnedAvailabilitySummary> {
    const [summary, reserves] = await Promise.all([
      this.balances.execute(actorId),
      this.reserves.listForOwner(actorId),
    ]);
    const byAccount = new Map(reserves.map((r) => [r.accountId, r]));
    const totals = new Map<string, CurrencyAvailabilityTotal>();
    const accounts = summary.accountBalances.map((line) => {
      const accountId = line.accountId.toLowerCase();
      const item = view(
        accountId,
        line.balance,
        byAccount.get(accountId) ?? null,
      );
      const key = `${line.balance.currency.code}:${String(line.balance.currency.minorUnitScale)}`;
      const total = totals.get(key);
      const { available, book, reserved } = item.availability;
      totals.set(
        key,
        total === undefined
          ? { available, book, reserved }
          : {
              available: total.available.add(available),
              book: total.book.add(book),
              reserved: total.reserved.add(reserved),
            },
      );
      return item;
    });
    return {
      accounts,
      totalsByCurrency: [...totals.values()].sort((left, right) =>
        left.book.currency.code.localeCompare(right.book.currency.code),
      ),
    };
  }
}

function view(
  accountId: string,
  balance: Money,
  reserve: AccountReserve | null,
): AccountAvailabilityView {
  const amount =
    reserve?.amount.currency.equals(balance.currency) === true
      ? reserve.amount
      : null;
  return {
    accountId,
    availability: calculateAccountAvailability(balance, amount),
    reserveVersion: reserve?.version ?? 0,
  };
}

export function serializeReserveResponse(reserve: AccountReserve): string {
  const snapshot = reserve.toSnapshot();
  return JSON.stringify({
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  });
}

export function parseReserveResponse(response: string): AccountReserve {
  const raw = JSON.parse(response) as Omit<
    AccountReserveSnapshot,
    'createdAt' | 'updatedAt'
  > & { createdAt: string; updatedAt: string };
  return AccountReserve.restore({
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  });
}
