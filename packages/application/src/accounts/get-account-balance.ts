import { calculateAccountBalance, type Money } from '@seshat/domain';

import type { TransactionRepository } from '../transactions/create-transaction.js';
import {
  OwnedAccountNotFoundError,
  type AccountRepository,
} from './create-account.js';

export class GetOwnedAccountBalanceUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly transactions: TransactionRepository,
  ) {}

  public async execute(accountId: string, actorId: string): Promise<Money> {
    const account = await this.accounts.findByIdForOwner(accountId, actorId);
    if (account === null) throw new OwnedAccountNotFoundError();
    const transactions = await this.transactions.listForAccountOwner(
      accountId,
      actorId,
    );
    return calculateAccountBalance(account.initialBalance, transactions);
  }
}
