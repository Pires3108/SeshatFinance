import {
  Currency,
  FinancialAuditEvent,
  Money,
  Transaction,
  type TransactionKind,
  type TransactionLifecycle,
} from '@seshat/domain';

import type { AccountRepository } from '../accounts/create-account.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface TransactionRepository {
  insert(
    transaction: Transaction,
    auditEvent: FinancialAuditEvent,
    idempotency?: Readonly<{ key: string; fingerprint: string }>,
  ): Promise<void>;
  findByIdempotencyKey?(
    ownerId: string,
    key: string,
  ): Promise<Readonly<{
    transaction: Transaction;
    fingerprint: string;
  }> | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<Transaction | null>;
  listRevisionsForOwner?(
    transactionId: string,
    ownerId: string,
  ): Promise<readonly TransactionRevision[]>;
  listForAccountOwner(
    accountId: string,
    ownerId: string,
    lifecycle?: TransactionLifecycle,
  ): Promise<readonly Transaction[]>;
  save(
    transaction: Transaction,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean>;
}

export type TransactionRevision = Readonly<{
  id: string;
  previousVersion: number;
  newVersion: number;
  before: unknown;
  after: unknown;
  occurredAt: Date;
}>;

export interface TransactionFinancialLinkRepository {
  findTransferIdByEntryForOwner(
    transactionId: string,
    ownerId: string,
  ): Promise<string | null>;
  /** Settlement whose account effect is this entry (US-041), if any. */
  findCardSettlementIdByEntryForOwner?(
    transactionId: string,
    ownerId: string,
  ): Promise<string | null>;
}

export class TransactionRequiresCardSettlementMutationError extends Error {
  public constructor(public readonly settlementId: string) {
    super('A card settlement entry cannot be changed on its own.');
    this.name = 'TransactionRequiresCardSettlementMutationError';
  }
}

/** Keeps the account effect of a declared settlement consistent (INV-015). */
export async function assertNotCardSettlementEntry(
  links: TransactionFinancialLinkRepository,
  transactionId: string,
  ownerId: string,
): Promise<void> {
  const settlementId = await links.findCardSettlementIdByEntryForOwner?.(
    transactionId,
    ownerId,
  );
  if (settlementId !== undefined && settlementId !== null) {
    throw new TransactionRequiresCardSettlementMutationError(settlementId);
  }
}

export type CreateTransactionCommand = Readonly<{
  accountId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  costCenterId?: string | null;
  tagIds?: readonly string[];
  idempotencyKey?: string;
  actorId: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
  kind: TransactionKind;
  observations?: string | null;
  occurredAt: Date;
}>;

export class TransactionAccountUnavailableError extends Error {
  public constructor() {
    super('An active owned account is required.');
    this.name = 'TransactionAccountUnavailableError';
  }
}

export class OwnedTransactionNotFoundError extends Error {
  public constructor() {
    super('Owned transaction was not found.');
    this.name = 'OwnedTransactionNotFoundError';
  }
}

export class TransactionVersionConflictError extends Error {
  public constructor() {
    super('Transaction was modified concurrently.');
    this.name = 'TransactionVersionConflictError';
  }
}

export class TransactionRequiresTransferMutationError extends Error {
  public constructor(public readonly transferId: string) {
    super('A transfer entry must be changed through its transfer.');
    this.name = 'TransactionRequiresTransferMutationError';
  }
}

export class InvalidTransactionInstantRangeError extends Error {
  public constructor() {
    super('Transaction instant range must be valid and non-empty.');
    this.name = 'InvalidTransactionInstantRangeError';
  }
}

export class CreateTransactionUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly accounts: AccountRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: CreateTransactionCommand,
  ): Promise<Transaction> {
    const fingerprint = JSON.stringify({
      ...command,
      idempotencyKey: undefined,
      occurredAt: command.occurredAt.toISOString(),
      tagIds: [...new Set(command.tagIds ?? [])].sort(),
    });
    if (command.idempotencyKey !== undefined) {
      if (this.transactions.findByIdempotencyKey === undefined)
        throw new Error('Idempotency repository is unavailable.');
      const previous = await this.transactions.findByIdempotencyKey(
        command.actorId,
        command.idempotencyKey,
      );
      if (previous !== null) {
        if (previous.fingerprint !== fingerprint)
          throw new TransactionIdempotencyConflictError();
        return previous.transaction;
      }
    }
    const account = await this.accounts.findByIdForOwner(
      command.accountId,
      command.actorId,
    );
    if (account?.lifecycle !== 'active') {
      throw new TransactionAccountUnavailableError();
    }
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    if (!currency.equals(account.initialBalance.currency)) {
      throw new TransactionAccountUnavailableError();
    }
    const at = this.clock.now();
    const transaction = Transaction.create({
      accountId: account.id,
      ...(command.categoryId === undefined
        ? {}
        : { categoryId: command.categoryId }),
      ...(command.subcategoryId === undefined
        ? {}
        : { subcategoryId: command.subcategoryId }),
      ...(command.costCenterId === undefined
        ? {}
        : { costCenterId: command.costCenterId }),
      ...(command.tagIds === undefined ? {} : { tagIds: command.tagIds }),
      amount: Money.fromDecimal(command.amount, currency),
      createdAt: at,
      description: command.description,
      counterpartyId: command.counterpartyId ?? null,
      counterpartyName: command.counterpartyName ?? null,
      id: this.identifiers.generate(),
      kind: command.kind,
      observations: command.observations ?? null,
      occurredAt: command.occurredAt,
      ownerId: command.actorId,
    });
    const auditEvent = FinancialAuditEvent.create({
      action: 'created',
      actorId: command.actorId,
      id: this.identifiers.generate(),
      occurredAt: at,
      ownerId: command.actorId,
      resourceId: transaction.id,
      resourceType: 'transaction',
    });
    try {
      await this.transactions.insert(
        transaction,
        auditEvent,
        command.idempotencyKey === undefined
          ? undefined
          : { key: command.idempotencyKey, fingerprint },
      );
    } catch (error) {
      if (command.idempotencyKey === undefined) throw error;
      if (this.transactions.findByIdempotencyKey === undefined) throw error;
      const previous = await this.transactions.findByIdempotencyKey(
        command.actorId,
        command.idempotencyKey,
      );
      if (previous === null) throw error;
      if (previous.fingerprint !== fingerprint)
        throw new TransactionIdempotencyConflictError();
      return previous.transaction;
    }
    return (
      (await this.transactions.findByIdForOwner(
        transaction.id,
        command.actorId,
      )) ?? transaction
    );
  }
}

export class TransactionIdempotencyConflictError extends Error {
  public constructor() {
    super('Idempotency key was used for different transaction details.');
    this.name = 'TransactionIdempotencyConflictError';
  }
}

export class GetOwnedTransactionUseCase {
  public constructor(private readonly transactions: TransactionRepository) {}

  public async revisions(
    transactionId: string,
    actorId: string,
  ): Promise<readonly TransactionRevision[]> {
    if (
      (await this.transactions.findByIdForOwner(transactionId, actorId)) ===
      null
    )
      throw new OwnedTransactionNotFoundError();
    return (
      (await this.transactions.listRevisionsForOwner?.(
        transactionId,
        actorId,
      )) ?? []
    );
  }

  public execute(
    transactionId: string,
    actorId: string,
  ): Promise<Transaction | null> {
    return this.transactions.findByIdForOwner(transactionId, actorId);
  }
}

export class ListOwnedAccountTransactionsUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly accounts: AccountRepository,
  ) {}

  public async execute(
    accountId: string,
    actorId: string,
    lifecycle?: TransactionLifecycle,
  ): Promise<readonly Transaction[]> {
    if ((await this.accounts.findByIdForOwner(accountId, actorId)) === null) {
      throw new TransactionAccountUnavailableError();
    }
    return this.transactions.listForAccountOwner(accountId, actorId, lifecycle);
  }
}

export interface TransactionTimelineRepository {
  listForOwnerBetween(
    ownerId: string,
    from: Date,
    to: Date,
    lifecycle?: TransactionLifecycle,
    filters?: TransactionTimelineFilters,
  ): Promise<readonly Transaction[]>;
}

export type TransactionTimelineFilters = Readonly<{
  accountId?: string;
  costCenterId?: string;
  kind?: TransactionKind;
  occurredAtOrder?: 'asc' | 'desc';
  tagId?: string;
}>;

export class ListOwnedTransactionsBetweenUseCase {
  public constructor(
    private readonly transactions: TransactionTimelineRepository,
  ) {}

  public execute(
    actorId: string,
    from: Date,
    to: Date,
    lifecycle?: TransactionLifecycle,
    filters?: TransactionTimelineFilters,
  ): Promise<readonly Transaction[]> {
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to
    ) {
      throw new InvalidTransactionInstantRangeError();
    }
    return this.transactions.listForOwnerBetween(
      actorId,
      from,
      to,
      lifecycle,
      filters,
    );
  }
}

export type UpdateOwnedTransactionCommand = Readonly<{
  actorId: string;
  expectedVersion?: number;
  categoryId?: string | null;
  subcategoryId?: string | null;
  costCenterId?: string | null;
  tagIds?: readonly string[];
  amount: string;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
  description: string | null;
  kind: TransactionKind;
  observations?: string | null;
  occurredAt: Date;
  transactionId: string;
}>;

export class UpdateOwnedTransactionUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly financialLinks: TransactionFinancialLinkRepository,
    private readonly accounts: AccountRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: UpdateOwnedTransactionCommand,
  ): Promise<Transaction> {
    const transaction = await this.requireOwned(
      command.transactionId,
      command.actorId,
    );
    await this.requireStandalone(transaction.id, command.actorId);
    const account = await this.accounts.findByIdForOwner(
      transaction.accountId,
      command.actorId,
    );
    if (account === null) throw new TransactionAccountUnavailableError();
    const expectedVersion = transaction.toSnapshot().version;
    if (
      command.expectedVersion !== undefined &&
      command.expectedVersion !== expectedVersion
    )
      throw new TransactionVersionConflictError();
    const at = this.clock.now();
    transaction.updateDetails(
      {
        ...(command.categoryId === undefined
          ? {}
          : { categoryId: command.categoryId }),
        ...(command.subcategoryId === undefined
          ? {}
          : { subcategoryId: command.subcategoryId }),
        ...(command.costCenterId === undefined
          ? {}
          : { costCenterId: command.costCenterId }),
        ...(command.tagIds === undefined ? {} : { tagIds: command.tagIds }),
        amount: Money.fromDecimal(
          command.amount,
          account.initialBalance.currency,
        ),
        ...(command.counterpartyId === undefined
          ? {}
          : { counterpartyId: command.counterpartyId }),
        ...(command.counterpartyName === undefined
          ? {}
          : { counterpartyName: command.counterpartyName }),
        description: command.description,
        kind: command.kind,
        observations:
          command.observations === undefined
            ? transaction.toSnapshot().observations
            : command.observations,
        occurredAt: command.occurredAt,
      },
      at,
    );
    await this.save(
      transaction,
      expectedVersion,
      FinancialAuditEvent.create({
        action: 'updated',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: transaction.id,
        resourceType: 'transaction',
      }),
    );
    return (
      (await this.transactions.findByIdForOwner(
        transaction.id,
        command.actorId,
      )) ?? transaction
    );
  }

  private async requireOwned(
    transactionId: string,
    actorId: string,
  ): Promise<Transaction> {
    const transaction = await this.transactions.findByIdForOwner(
      transactionId,
      actorId,
    );
    if (transaction === null) throw new OwnedTransactionNotFoundError();
    return transaction;
  }

  private async requireStandalone(
    transactionId: string,
    actorId: string,
  ): Promise<void> {
    const transferId = await this.financialLinks.findTransferIdByEntryForOwner(
      transactionId,
      actorId,
    );
    if (transferId !== null) {
      throw new TransactionRequiresTransferMutationError(transferId);
    }
    await assertNotCardSettlementEntry(
      this.financialLinks,
      transactionId,
      actorId,
    );
  }

  private async save(
    transaction: Transaction,
    expectedVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<void> {
    if (
      !(await this.transactions.save(transaction, expectedVersion, auditEvent))
    ) {
      throw new TransactionVersionConflictError();
    }
  }
}

export type TransactionLifecycleAction =
  'archive' | 'unarchive' | 'move-to-trash' | 'restore-from-trash';

export class ChangeOwnedTransactionLifecycleUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly financialLinks: TransactionFinancialLinkRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: {
    action: TransactionLifecycleAction;
    actorId: string;
    transactionId: string;
  }): Promise<Transaction> {
    const transaction = await this.transactions.findByIdForOwner(
      command.transactionId,
      command.actorId,
    );
    if (transaction === null) throw new OwnedTransactionNotFoundError();
    const transferId = await this.financialLinks.findTransferIdByEntryForOwner(
      transaction.id,
      command.actorId,
    );
    if (transferId !== null) {
      throw new TransactionRequiresTransferMutationError(transferId);
    }
    await assertNotCardSettlementEntry(
      this.financialLinks,
      transaction.id,
      command.actorId,
    );
    const expectedVersion = transaction.toSnapshot().version;
    const at = this.clock.now();
    let changed = true;
    switch (command.action) {
      case 'archive':
        transaction.archive(at);
        break;
      case 'unarchive':
        transaction.unarchive(at);
        break;
      case 'move-to-trash':
        changed = transaction.moveToTrash(at);
        break;
      case 'restore-from-trash':
        changed = transaction.restoreFromTrash(at);
        break;
    }
    // Repeating trash or restore is a no-op: no write, version or audit.
    if (!changed) return transaction;
    const auditEvent = FinancialAuditEvent.create({
      action: lifecycleAuditAction(command.action),
      actorId: command.actorId,
      id: this.identifiers.generate(),
      occurredAt: at,
      ownerId: command.actorId,
      resourceId: transaction.id,
      resourceType: 'transaction',
    });
    if (
      !(await this.transactions.save(transaction, expectedVersion, auditEvent))
    ) {
      throw new TransactionVersionConflictError();
    }
    return transaction;
  }
}

function lifecycleAuditAction(
  action: TransactionLifecycleAction,
): 'archived' | 'unarchived' | 'moved-to-trash' | 'restored-from-trash' {
  switch (action) {
    case 'archive':
      return 'archived';
    case 'unarchive':
      return 'unarchived';
    case 'move-to-trash':
      return 'moved-to-trash';
    case 'restore-from-trash':
      return 'restored-from-trash';
  }
}
