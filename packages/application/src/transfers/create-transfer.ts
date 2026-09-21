import { Currency, Money, Transfer } from '@seshat/domain';

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
  insertAtomically(transfer: Transfer): Promise<void>;
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
    const transfer = Transfer.create({
      amount: Money.fromDecimal(command.amount, currency),
      createdAt: this.clock.now(),
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
    await this.transfers.insertAtomically(transfer);
    return transfer;
  }
}
