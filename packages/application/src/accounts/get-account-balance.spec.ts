import {
  Account,
  AccountType,
  Currency,
  Money,
  Transaction,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { TransactionRepository } from '../transactions/create-transaction.js';
import type { AccountRepository } from './create-account.js';
import { GetOwnedAccountBalanceUseCase } from './get-account-balance.js';

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

function transactions(values: readonly Transaction[]): TransactionRepository {
  return {
    findByIdForOwner: (): Promise<Transaction | null> => Promise.resolve(null),
    insert: (): Promise<void> => Promise.resolve(),
    listForAccountOwner: (): Promise<readonly Transaction[]> =>
      Promise.resolve(values),
    save: (): Promise<boolean> => Promise.resolve(true),
  };
}

describe('GetOwnedAccountBalanceUseCase', () => {
  it('calculates initial balance plus only effective owned records', async () => {
    const ownedAccount = account();
    const income = Transaction.create({
      accountId: ownedAccount.id,
      amount: Money.fromDecimal('25.10', currency),
      createdAt: new Date('2026-09-20T13:00:00.000Z'),
      description: null,
      id: 'income-id',
      kind: 'income',
      occurredAt: new Date('2026-09-20T11:00:00.000Z'),
      ownerId: ownedAccount.ownerId,
    });
    const trashedExpense = Transaction.create({
      accountId: ownedAccount.id,
      amount: Money.fromDecimal('10.00', currency),
      createdAt: new Date('2026-09-20T13:00:00.000Z'),
      description: null,
      id: 'expense-id',
      kind: 'expense',
      occurredAt: new Date('2026-09-20T11:00:00.000Z'),
      ownerId: ownedAccount.ownerId,
    });
    trashedExpense.moveToTrash(new Date('2026-09-20T14:00:00.000Z'));
    const useCase = new GetOwnedAccountBalanceUseCase(
      accounts(ownedAccount),
      transactions([income, trashedExpense]),
    );

    const balance = await useCase.execute(
      ownedAccount.id,
      ownedAccount.ownerId,
    );

    expect(balance.currency).toEqual(currency);
    expect(balance.toDecimal()).toBe('125.10');
  });
});
