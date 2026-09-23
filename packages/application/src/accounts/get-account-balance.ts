import type { Money } from '@seshat/domain';

import {
  OwnedAccountNotFoundError,
  type AccountRepository,
} from './create-account.js';

export interface AccountTransactionBalanceRepository {
  sumBalanceEffectsForAccountOwner(
    accountId: string,
    ownerId: string,
  ): Promise<readonly Money[]>;
}

export class GetOwnedAccountBalanceUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly transactions: AccountTransactionBalanceRepository,
  ) {}

  public async execute(accountId: string, actorId: string): Promise<Money> {
    const account = await this.accounts.findByIdForOwner(accountId, actorId);
    if (account === null) throw new OwnedAccountNotFoundError();
    const effects = await this.transactions.sumBalanceEffectsForAccountOwner(
      accountId,
      actorId,
    );
    return effects.reduce(
      (balance, effect) => balance.add(effect),
      account.initialBalance,
    );
  }
}
