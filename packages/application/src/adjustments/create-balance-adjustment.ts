import {
  BalanceAdjustment,
  calculateAccountBalance,
  Currency,
  FinancialAuditEvent,
  Money,
  type TransactionKind,
} from '@seshat/domain';

import type { AccountRepository } from '../accounts/create-account.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { TransactionRepository } from '../transactions/create-transaction.js';
import type { BalanceAdjustmentHistoryItem } from './list-balance-adjustments.js';

export type CreateBalanceAdjustmentCommand = Readonly<{
  accountId: string;
  actorId: string;
  idempotencyKey: string;
  justification: string;
  occurredAt: Date;
  reportedBalance: string;
}>;

export const CREATE_BALANCE_ADJUSTMENT_OPERATION = 'balance-adjustment.create';

/** Stored idempotent response: the adjustment as originally recorded. */
export type IdempotentBalanceAdjustmentRecord = Readonly<{
  request: IdempotencyRequest;
  response: string;
}>;

export interface BalanceAdjustmentRepository {
  /**
   * Returns the stored response for an unexpired key with the same payload,
   * null when the key is unused or expired, and throws
   * IdempotencyConflictError when the payload differs.
   */
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  /**
   * Verifies the previous balance and records the adjustment, its
   * transaction, the audit event and the idempotency record in one
   * serializable database transaction. Returns the stored response (also
   * when an identical request committed first), or null when the account
   * balance changed concurrently. Throws IdempotencyConflictError when the
   * payload differs or the key is being processed concurrently.
   */
  insertAtomically(
    adjustment: BalanceAdjustment,
    auditEvent: FinancialAuditEvent,
    idempotency: IdempotentBalanceAdjustmentRecord,
  ): Promise<string | null>;
}

export class BalanceAdjustmentAccountUnavailableError extends Error {
  public constructor() {
    super('An active owned account is required.');
    this.name = 'BalanceAdjustmentAccountUnavailableError';
  }
}

export class BalanceAdjustmentBalanceConflictError extends Error {
  public constructor() {
    super('Account balance changed during reconciliation.');
    this.name = 'BalanceAdjustmentBalanceConflictError';
  }
}

export class CreateBalanceAdjustmentUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly transactions: TransactionRepository,
    private readonly adjustments: BalanceAdjustmentRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: CreateBalanceAdjustmentCommand,
  ): Promise<BalanceAdjustmentHistoryItem> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.clock.now();
    const request: IdempotencyRequest = {
      key,
      operation: CREATE_BALANCE_ADJUSTMENT_OPERATION,
      ownerId: command.actorId,
      payload: {
        accountId: command.accountId.toLowerCase(),
        justification: command.justification.trim(),
        occurredAt: command.occurredAt.toISOString(),
        reportedBalance: canonicalDecimal(command.reportedBalance),
      },
      requestedAt: at,
    };
    const replayed = await this.adjustments.findIdempotentResponse(request);
    if (replayed !== null) return parseBalanceAdjustmentResponse(replayed);
    const account = await this.accounts.findByIdForOwner(
      command.accountId,
      command.actorId,
    );
    if (account?.lifecycle !== 'active') {
      throw new BalanceAdjustmentAccountUnavailableError();
    }
    const transactions = await this.transactions.listForAccountOwner(
      account.id,
      command.actorId,
    );
    const previousBalance = calculateAccountBalance(
      account.initialBalance,
      transactions,
    );
    const adjustment = BalanceAdjustment.create({
      accountId: account.id,
      createdAt: at,
      id: this.identifiers.generate(),
      justification: command.justification,
      occurredAt: command.occurredAt,
      ownerId: command.actorId,
      previousBalance,
      reportedBalance: Money.fromDecimal(
        command.reportedBalance,
        previousBalance.currency,
      ),
      transactionId: this.identifiers.generate(),
    });
    const stored = await this.adjustments.insertAtomically(
      adjustment,
      FinancialAuditEvent.create({
        action: 'created',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: adjustment.id,
        resourceType: 'balance-adjustment',
      }),
      { request, response: serializeBalanceAdjustmentResponse(adjustment) },
    );
    if (stored === null) throw new BalanceAdjustmentBalanceConflictError();
    return parseBalanceAdjustmentResponse(stored);
  }
}

type StoredBalanceAdjustment = Readonly<{
  accountId: string;
  createdAt: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  difference: string;
  id: string;
  justification: string;
  occurredAt: string;
  previousBalance: string;
  reportedBalance: string;
  transactionId: string;
  transactionKind: TransactionKind;
}>;

/** Serializes the adjustment exactly as recorded, for idempotent replay. */
export function serializeBalanceAdjustmentResponse(
  adjustment: BalanceAdjustment,
): string {
  const snapshot = adjustment.toSnapshot();
  const stored: StoredBalanceAdjustment = {
    accountId: snapshot.transaction.accountId,
    createdAt: snapshot.transaction.createdAt.toISOString(),
    currencyCode: snapshot.difference.currency.code,
    currencyMinorUnitScale: snapshot.difference.currency.minorUnitScale,
    difference: snapshot.difference.amount,
    id: snapshot.id,
    justification: snapshot.justification,
    occurredAt: snapshot.transaction.occurredAt.toISOString(),
    previousBalance: snapshot.previousBalance.amount,
    reportedBalance: snapshot.reportedBalance.amount,
    transactionId: snapshot.transaction.id,
    transactionKind: snapshot.transaction.kind,
  };
  return JSON.stringify(stored);
}

export function parseBalanceAdjustmentResponse(
  response: string,
): BalanceAdjustmentHistoryItem {
  const stored = JSON.parse(response) as StoredBalanceAdjustment;
  const currency = Currency.create(
    stored.currencyCode,
    stored.currencyMinorUnitScale,
  );
  return {
    accountId: stored.accountId,
    createdAt: new Date(stored.createdAt),
    difference: Money.fromDecimal(stored.difference, currency),
    id: stored.id,
    justification: stored.justification,
    occurredAt: new Date(stored.occurredAt),
    previousBalance: Money.fromDecimal(stored.previousBalance, currency),
    reportedBalance: Money.fromDecimal(stored.reportedBalance, currency),
    transactionId: stored.transactionId,
    transactionKind: stored.transactionKind,
  };
}

const decimalPattern = /^(-?)(\d+)(?:\.(\d+))?$/u;

/**
 * Canonical decimal text so that "010.50" and "10.5" hash identically. The
 * currency scale is unknown before the account is read, so trailing zeros
 * are removed instead of padded. Invalid text is kept for later validation.
 */
function canonicalDecimal(value: string): string {
  const text = value.trim();
  const match = decimalPattern.exec(text);
  if (match === null) return text;
  const whole = (match[2] ?? '0').replace(/^0+(?=\d)/u, '');
  const fraction = (match[3] ?? '').replace(/0+$/u, '');
  const digits = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return match[1] === '-' && /[1-9]/u.test(digits) ? `-${digits}` : digits;
}
