import {
  BalanceAdjustment,
  calculateAccountBalance,
  Money,
} from '@seshat/domain';

import type { AccountRepository } from '../accounts/create-account.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import type { TransactionRepository } from '../transactions/create-transaction.js';

export type CreateBalanceAdjustmentCommand = Readonly<{
  accountId: string;
  actorId: string;
  justification: string;
  occurredAt: Date;
  reportedBalance: string;
}>;

export interface BalanceAdjustmentRepository {
  insertAtomically(adjustment: BalanceAdjustment): Promise<boolean>;
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
  ): Promise<BalanceAdjustment> {
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
      createdAt: this.clock.now(),
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
    const inserted = await this.adjustments.insertAtomically(adjustment);
    if (!inserted) throw new BalanceAdjustmentBalanceConflictError();
    return adjustment;
  }
}
