import type { Money, TransactionKind } from '@seshat/domain';

import {
  OwnedAccountNotFoundError,
  type AccountRepository,
} from '../accounts/create-account.js';

export type BalanceAdjustmentHistoryItem = Readonly<{
  accountId: string;
  createdAt: Date;
  difference: Money;
  id: string;
  justification: string;
  occurredAt: Date;
  previousBalance: Money;
  reportedBalance: Money;
  transactionId: string;
  transactionKind: TransactionKind;
}>;

export interface BalanceAdjustmentHistoryRepository {
  listForAccountOwner(
    accountId: string,
    ownerId: string,
  ): Promise<readonly BalanceAdjustmentHistoryItem[]>;
}

export class ListOwnedBalanceAdjustmentsUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly adjustments: BalanceAdjustmentHistoryRepository,
  ) {}

  public async execute(
    accountId: string,
    actorId: string,
  ): Promise<readonly BalanceAdjustmentHistoryItem[]> {
    const account = await this.accounts.findByIdForOwner(accountId, actorId);
    if (account === null) throw new OwnedAccountNotFoundError();
    return this.adjustments.listForAccountOwner(account.id, actorId);
  }
}
