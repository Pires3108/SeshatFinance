import {
  Currency,
  Money,
  Transaction,
  type TransactionKind,
} from '@seshat/domain';

import type { AccountRepository } from '../accounts/create-account.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface TransactionRepository {
  insert(transaction: Transaction): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<Transaction | null>;
  listForAccountOwner(
    accountId: string,
    ownerId: string,
  ): Promise<readonly Transaction[]>;
  save(transaction: Transaction, expectedVersion: number): Promise<boolean>;
}

export type CreateTransactionCommand = Readonly<{
  accountId: string;
  actorId: string;
  amount: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  description: string | null;
  kind: TransactionKind;
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
    const transaction = Transaction.create({
      accountId: account.id,
      amount: Money.fromDecimal(command.amount, currency),
      createdAt: this.clock.now(),
      description: command.description,
      id: this.identifiers.generate(),
      kind: command.kind,
      occurredAt: command.occurredAt,
      ownerId: command.actorId,
    });
    await this.transactions.insert(transaction);
    return transaction;
  }
}

export class GetOwnedTransactionUseCase {
  public constructor(private readonly transactions: TransactionRepository) {}

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
  ): Promise<readonly Transaction[]> {
    if ((await this.accounts.findByIdForOwner(accountId, actorId)) === null) {
      throw new TransactionAccountUnavailableError();
    }
    return this.transactions.listForAccountOwner(accountId, actorId);
  }
}

export type UpdateOwnedTransactionCommand = Readonly<{
  actorId: string;
  amount: string;
  description: string | null;
  kind: TransactionKind;
  occurredAt: Date;
  transactionId: string;
}>;

export class UpdateOwnedTransactionUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly accounts: AccountRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(
    command: UpdateOwnedTransactionCommand,
  ): Promise<Transaction> {
    const transaction = await this.requireOwned(
      command.transactionId,
      command.actorId,
    );
    const account = await this.accounts.findByIdForOwner(
      transaction.accountId,
      command.actorId,
    );
    if (account === null) throw new TransactionAccountUnavailableError();
    const expectedVersion = transaction.toSnapshot().version;
    transaction.updateDetails(
      {
        amount: Money.fromDecimal(
          command.amount,
          account.initialBalance.currency,
        ),
        description: command.description,
        kind: command.kind,
        occurredAt: command.occurredAt,
      },
      this.clock.now(),
    );
    await this.save(transaction, expectedVersion);
    return transaction;
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

  private async save(
    transaction: Transaction,
    expectedVersion: number,
  ): Promise<void> {
    if (!(await this.transactions.save(transaction, expectedVersion))) {
      throw new TransactionVersionConflictError();
    }
  }
}

export type TransactionLifecycleAction =
  'archive' | 'unarchive' | 'move-to-trash' | 'restore-from-trash';

export class ChangeOwnedTransactionLifecycleUseCase {
  public constructor(
    private readonly transactions: TransactionRepository,
    private readonly clock: Clock,
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
    const expectedVersion = transaction.toSnapshot().version;
    const at = this.clock.now();
    switch (command.action) {
      case 'archive':
        transaction.archive(at);
        break;
      case 'unarchive':
        transaction.unarchive(at);
        break;
      case 'move-to-trash':
        transaction.moveToTrash(at);
        break;
      case 'restore-from-trash':
        transaction.restoreFromTrash(at);
        break;
    }
    if (!(await this.transactions.save(transaction, expectedVersion))) {
      throw new TransactionVersionConflictError();
    }
    return transaction;
  }
}
