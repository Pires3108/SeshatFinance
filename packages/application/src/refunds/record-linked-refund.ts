import {
  Currency,
  FinancialAuditEvent,
  Money,
  Transaction,
  type RefundSummary,
} from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export type LinkedRefundKind = 'refund' | 'compensation';

export type RecordLinkedRefundCommand = Readonly<{
  actorId: string;
  expenseTransactionId: string;
  accountId: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  occurredAt: Date;
  idempotencyKey: string;
  compensatesRefundId?: string;
  reason?: string;
}>;

export type LinkedRefundRecord = Readonly<{
  id: string;
  expenseTransactionId: string;
  entry: Transaction;
  kind: LinkedRefundKind;
  compensatesRefundId: string | null;
  reason: string | null;
  createdAt: Date;
}>;

export type LinkedRefundDetails = Readonly<{
  expenseTransactionId: string;
  summary: RefundSummary;
  entries: readonly LinkedRefundRecord[];
}>;

export interface LinkedRefundRepository {
  record(
    record: LinkedRefundRecord,
    idempotencyKey: string,
    auditEvent: FinancialAuditEvent,
  ): Promise<LinkedRefundRecord>;
  getForExpense(
    expenseTransactionId: string,
    ownerId: string,
  ): Promise<LinkedRefundDetails | null>;
}

export class LinkedRefundUnavailableError extends Error {
  public constructor() {
    super('The expense, account or refund is unavailable.');
    this.name = 'LinkedRefundUnavailableError';
  }
}

export class LinkedRefundConflictError extends Error {
  public constructor(
    message = 'The linked refund conflicts with current state.',
  ) {
    super(message);
    this.name = 'LinkedRefundConflictError';
  }
}

export class InvalidLinkedRefundCommandError extends Error {
  public constructor() {
    super('The linked refund command is invalid.');
    this.name = 'InvalidLinkedRefundCommandError';
  }
}

export class RecordLinkedRefundUseCase {
  public constructor(
    private readonly refunds: LinkedRefundRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: RecordLinkedRefundCommand,
  ): Promise<LinkedRefundRecord> {
    const reason = command.reason?.trim() ?? null;
    const compensatesRefundId = command.compensatesRefundId ?? null;
    if (
      (compensatesRefundId === null && reason !== null) ||
      (compensatesRefundId !== null && !reason)
    ) {
      throw new InvalidLinkedRefundCommandError();
    }
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    const amount = Money.fromDecimal(command.amount, currency);
    const at = this.clock.now();
    const entry = Transaction.create({
      accountId: command.accountId,
      amount,
      createdAt: at,
      description: command.description,
      id: this.identifiers.generate(),
      kind: compensatesRefundId === null ? 'income' : 'expense',
      occurredAt: command.occurredAt,
      ownerId: command.actorId,
    });
    const record: LinkedRefundRecord = {
      id: this.identifiers.generate(),
      expenseTransactionId: command.expenseTransactionId,
      entry,
      kind: compensatesRefundId === null ? 'refund' : 'compensation',
      compensatesRefundId,
      reason,
      createdAt: at,
    };
    const auditEvent = FinancialAuditEvent.create({
      action: 'created',
      actorId: command.actorId,
      id: this.identifiers.generate(),
      occurredAt: at,
      ownerId: command.actorId,
      resourceId: entry.id,
      resourceType: 'transaction',
    });
    return this.refunds.record(record, command.idempotencyKey, auditEvent);
  }
}

export class GetOwnedLinkedRefundsUseCase {
  public constructor(private readonly refunds: LinkedRefundRepository) {}

  public getForExpense(
    expenseTransactionId: string,
    actorId: string,
  ): Promise<LinkedRefundDetails | null> {
    return this.refunds.getForExpense(expenseTransactionId, actorId);
  }
}
