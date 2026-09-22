import { Currency, FinancialAuditEvent, Money, Transfer } from '@seshat/domain';

import type { AccountRepository } from '../accounts/create-account.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export type CreateTransferCommand = Readonly<{
  actorId: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  destinationAccountId: string;
  observations: string | null;
  occurredAt: Date;
  sourceAccountId: string;
}>;

export interface TransferRepository {
  insertAtomically(
    transfer: Transfer,
    auditEvent: FinancialAuditEvent,
  ): Promise<void>;
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
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    if (!currency.equals(source.initialBalance.currency)) {
      throw new TransferCurrencyMismatchError();
    }
    const transferId = this.identifiers.generate();
    const sourceTransactionId = this.identifiers.generate();
    const destinationTransactionId = this.identifiers.generate();
    const at = this.clock.now();
    const transfer = Transfer.create({
      amount: Money.fromDecimal(command.amount, currency),
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
    await this.transfers.insertAtomically(
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
    );
    return transfer;
  }
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
