import type { AccountRepository } from '../accounts/create-account.js';
import {
  Account,
  AccountType,
  Currency,
  Money,
  type Transaction,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  CreateTransactionUseCase,
  TransactionAccountUnavailableError,
  type TransactionRepository,
} from './create-transaction.js';

class RecordingTransactions implements TransactionRepository {
  public inserted: Transaction | undefined;
  public insert(transaction: Transaction): Promise<void> {
    this.inserted = transaction;
    return Promise.resolve();
  }
  public findByIdForOwner(): Promise<Transaction | null> {
    return Promise.resolve(null);
  }
  public listForAccountOwner(): Promise<readonly Transaction[]> {
    return Promise.resolve([]);
  }
  public save(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

function accounts(): AccountRepository {
  const account = Account.create({
    color: null,
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    description: null,
    icon: null,
    id: 'account-id',
    initialBalance: Money.fromDecimal('0', Currency.create('BRL', 2)),
    institution: null,
    name: 'Conta',
    ownerId: 'owner-id',
    type: AccountType.create('checking-account'),
  });
  return {
    findByIdForOwner: (id, ownerId): Promise<Account | null> =>
      Promise.resolve(
        id === account.id && ownerId === account.ownerId ? account : null,
      ),
    insert: (): Promise<void> => Promise.resolve(),
    listForOwner: (): Promise<readonly Account[]> => Promise.resolve([]),
    save: (): Promise<boolean> => Promise.resolve(true),
  };
}

describe('CreateTransactionUseCase', () => {
  it('creates an exact owned transaction using injected dependencies', async () => {
    const repository = new RecordingTransactions();
    const useCase = new CreateTransactionUseCase(
      repository,
      accounts(),
      { now: (): Date => new Date('2026-09-20T13:00:00.000Z') },
      { generate: (): string => 'transaction-id' },
    );

    const result = await useCase.execute({
      accountId: 'account-id',
      actorId: 'owner-id',
      amount: '12.34',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: 'Receita',
      kind: 'income',
      occurredAt: new Date('2026-09-20T11:00:00.000Z'),
    });

    expect(repository.inserted).toBe(result);
    expect(result.amount.toDecimal()).toBe('12.34');
  });

  it('rejects accounts not owned by the actor', async () => {
    const useCase = new CreateTransactionUseCase(
      new RecordingTransactions(),
      accounts(),
      { now: (): Date => new Date('2026-09-20T13:00:00.000Z') },
      { generate: (): string => 'transaction-id' },
    );

    await expect(
      useCase.execute({
        accountId: 'account-id',
        actorId: 'other-owner',
        amount: '12.34',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: null,
        kind: 'expense',
        occurredAt: new Date('2026-09-20T11:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(TransactionAccountUnavailableError);
  });
});
