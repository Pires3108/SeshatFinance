import { Account, AccountType, Currency, Money } from '@seshat/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  OwnedAccountNotFoundError,
  type AccountRepository,
} from './create-account.js';
import {
  GetOwnedAccountBalanceUseCase,
  type AccountTransactionBalanceRepository,
} from './get-account-balance.js';

const currency = Currency.create('BRL', 2);

function account(): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    description: null,
    icon: null,
    id: 'account-id',
    initialBalance: Money.fromDecimal('100.00', currency),
    institution: null,
    name: 'Conta',
    ownerId: 'owner-id',
    type: AccountType.create('checking-account'),
  });
}

function accounts(value: Account): AccountRepository {
  return {
    findByIdForOwner: (id, ownerId): Promise<Account | null> =>
      Promise.resolve(
        id === value.id && ownerId === value.ownerId ? value : null,
      ),
    insert: (): Promise<void> => Promise.resolve(),
    listForOwner: (): Promise<readonly Account[]> => Promise.resolve([]),
    save: (): Promise<boolean> => Promise.resolve(true),
  };
}

function transactions(
  values: readonly Money[],
): AccountTransactionBalanceRepository {
  return {
    sumBalanceEffectsForAccountOwner: (): Promise<readonly Money[]> =>
      Promise.resolve(values),
  };
}

describe('GetOwnedAccountBalanceUseCase', () => {
  it('adds exact grouped income and expense effects to the initial balance', async () => {
    const ownedAccount = account();
    const useCase = new GetOwnedAccountBalanceUseCase(
      accounts(ownedAccount),
      transactions([
        Money.fromDecimal('25.10', currency),
        Money.fromDecimal('-10.00', currency),
      ]),
    );

    const balance = await useCase.execute(
      ownedAccount.id,
      ownedAccount.ownerId,
    );

    expect(balance.currency).toEqual(currency);
    expect(balance.toDecimal()).toBe('115.10');
  });

  it('does not query financial records when the actor does not own the account', async () => {
    const sumBalanceEffectsForAccountOwner = vi.fn().mockResolvedValue([]);
    const repository = transactions([]);
    const useCase = new GetOwnedAccountBalanceUseCase(accounts(account()), {
      ...repository,
      sumBalanceEffectsForAccountOwner,
    });

    await expect(
      useCase.execute('account-id', 'foreign-owner'),
    ).rejects.toThrow(OwnedAccountNotFoundError);
    expect(sumBalanceEffectsForAccountOwner).not.toHaveBeenCalled();
  });

  it('rejects a persisted balance effect in another currency', async () => {
    const useCase = new GetOwnedAccountBalanceUseCase(
      accounts(account()),
      transactions([Money.fromDecimal('1.00', Currency.create('USD', 2))]),
    );

    await expect(useCase.execute('account-id', 'owner-id')).rejects.toThrow();
  });
});
