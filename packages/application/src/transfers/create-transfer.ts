import {
  Currency,
  FinancialAuditEvent,
  Money,
  Transfer,
  type TransferSnapshot,
} from '@seshat/domain';

import type { AccountRepository } from '../accounts/create-account.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';

export type CreateTransferCommand = Readonly<{
  actorId: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  destinationAccountId: string;
  idempotencyKey: string;
  observations: string | null;
  occurredAt: Date;
  sourceAccountId: string;
}>;

export const CREATE_TRANSFER_OPERATION = 'transfer.create';

/** Stored idempotent response: the transfer snapshot as originally recorded. */
export type IdempotentTransferRecord = Readonly<{
  request: IdempotencyRequest;
  response: string;
}>;

export interface TransferRepository {
  /**
   * Returns the stored response for an unexpired key with the same payload,
   * null when the key is unused or expired, and throws
   * IdempotencyConflictError when the payload differs.
   */
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  /**
   * Records both legs, the audit event and the idempotency record in one
   * database transaction. Returns the stored response instead of writing when
   * an identical request committed first; throws IdempotencyConflictError
   * when the payload differs or the key is being processed concurrently.
   */
  insertAtomically(
    transfer: Transfer,
    auditEvent: FinancialAuditEvent,
    idempotency: IdempotentTransferRecord,
  ): Promise<string>;
}

export interface TransferLifecycleRepository {
  findByIdForOwner(id: string, ownerId: string): Promise<Transfer | null>;
  saveAtomically(
    transfer: Transfer,
    expectedSourceVersion: number,
    expectedDestinationVersion: number,
    auditEvent: FinancialAuditEvent,
  ): Promise<boolean>;
}

export class TransferAccountUnavailableError extends Error {
  public constructor() {
    super('Two distinct active owned accounts are required.');
    this.name = 'TransferAccountUnavailableError';
  }
}

export class TransferCurrencyMismatchError extends Error {
  public constructor() {
    super('Transfer accounts must use the same currency.');
    this.name = 'TransferCurrencyMismatchError';
  }
}

export class OwnedTransferNotFoundError extends Error {
  public constructor() {
    super('Owned transfer was not found.');
    this.name = 'OwnedTransferNotFoundError';
  }
}

export class TransferVersionConflictError extends Error {
  public constructor() {
    super('Transfer was modified concurrently.');
    this.name = 'TransferVersionConflictError';
  }
}

export class CreateTransferUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly transfers: TransferRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateTransferCommand): Promise<Transfer> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    const amount = Money.fromDecimal(command.amount, currency);
    const at = this.clock.now();
    const request: IdempotencyRequest = {
      key,
      operation: CREATE_TRANSFER_OPERATION,
      ownerId: command.actorId,
      payload: {
        amount: amount.toDecimal(),
        currencyCode: currency.code,
        currencyMinorUnitScale: currency.minorUnitScale,
        description: command.description?.trim() ?? null,
        destinationAccountId: command.destinationAccountId.toLowerCase(),
        observations: command.observations?.trim() ?? null,
        occurredAt: command.occurredAt.toISOString(),
        sourceAccountId: command.sourceAccountId.toLowerCase(),
      },
      requestedAt: at,
    };
    const replayed = await this.transfers.findIdempotentResponse(request);
    if (replayed !== null) return parseTransferResponse(replayed);
    if (command.sourceAccountId === command.destinationAccountId) {
      throw new TransferAccountUnavailableError();
    }
    const [source, destination] = await Promise.all([
      this.accounts.findByIdForOwner(command.sourceAccountId, command.actorId),
      this.accounts.findByIdForOwner(
        command.destinationAccountId,
        command.actorId,
      ),
    ]);
    if (source?.lifecycle !== 'active' || destination?.lifecycle !== 'active') {
      throw new TransferAccountUnavailableError();
    }
    if (
      !source.initialBalance.currency.equals(
        destination.initialBalance.currency,
      )
    ) {
      throw new TransferCurrencyMismatchError();
    }
    if (!currency.equals(source.initialBalance.currency)) {
      throw new TransferCurrencyMismatchError();
    }
    const transferId = this.identifiers.generate();
    const sourceTransactionId = this.identifiers.generate();
    const destinationTransactionId = this.identifiers.generate();
    const transfer = Transfer.create({
      amount,
      createdAt: at,
      description: command.description,
      destinationAccountId: destination.id,
      destinationTransactionId,
      id: transferId,
      observations: command.observations,
      occurredAt: command.occurredAt,
      ownerId: command.actorId,
      sourceAccountId: source.id,
      sourceTransactionId,
    });
    const stored = await this.transfers.insertAtomically(
      transfer,
      FinancialAuditEvent.create({
        action: 'created',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: transfer.id,
        resourceType: 'transfer',
      }),
      { request, response: serializeTransferResponse(transfer) },
    );
    return parseTransferResponse(stored);
  }
}

const snapshotDateFields = new Set([
  'archivedAt',
  'createdAt',
  'occurredAt',
  'trashedAt',
  'updatedAt',
]);

/** Serializes the transfer exactly as recorded, for idempotent replay. */
export function serializeTransferResponse(transfer: Transfer): string {
  return JSON.stringify(transfer.toSnapshot());
}

export function parseTransferResponse(response: string): Transfer {
  const snapshot = JSON.parse(response, (key: string, value: unknown) =>
    snapshotDateFields.has(key) && typeof value === 'string'
      ? new Date(value)
      : value,
  ) as TransferSnapshot;
  return Transfer.restore(snapshot);
}

export type TransferLifecycleAction =
  'archive' | 'unarchive' | 'move-to-trash' | 'restore-from-trash';

export class ChangeOwnedTransferLifecycleUseCase {
  public constructor(
    private readonly transfers: TransferLifecycleRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: {
    action: TransferLifecycleAction;
    actorId: string;
    transferId: string;
  }): Promise<Transfer> {
    const transfer = await this.transfers.findByIdForOwner(
      command.transferId,
      command.actorId,
    );
    if (transfer === null) throw new OwnedTransferNotFoundError();
    const before = transfer.toSnapshot();
    const at = this.clock.now();
    switch (command.action) {
      case 'archive':
        transfer.archive(at);
        break;
      case 'unarchive':
        transfer.unarchive(at);
        break;
      case 'move-to-trash':
        transfer.moveToTrash(at);
        break;
      case 'restore-from-trash':
        transfer.restoreFromTrash(at);
        break;
    }
    const saved = await this.transfers.saveAtomically(
      transfer,
      before.source.version,
      before.destination.version,
      FinancialAuditEvent.create({
        action: lifecycleAuditAction(command.action),
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: transfer.id,
        resourceType: 'transfer',
      }),
    );
    if (!saved) throw new TransferVersionConflictError();
    return transfer;
  }
}

function lifecycleAuditAction(
  action: TransferLifecycleAction,
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
