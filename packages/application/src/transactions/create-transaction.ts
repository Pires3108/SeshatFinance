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
