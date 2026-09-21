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
  ChangeOwnedTransactionLifecycleUseCase,
  CreateTransactionUseCase,
  TransactionAccountUnavailableError,
  UpdateOwnedTransactionUseCase,
  type TransactionRepository,
} from './create-transaction.js';

class RecordingTransactions implements TransactionRepository {
  public inserted: Transaction | undefined;
  public insert(transaction: Transaction): Promise<void> {
    this.inserted = transaction;
    return Promise.resolve();
  }
  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Transaction | null> {
    return Promise.resolve(
      this.inserted?.id === id && this.inserted.ownerId === ownerId
        ? this.inserted
        : null,
    );
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
      observations: 'Confirmada no banco',
      occurredAt: new Date('2026-09-20T11:00:00.000Z'),
    });

    expect(repository.inserted).toBe(result);
    expect(result.amount.toDecimal()).toBe('12.34');
    expect(result.toSnapshot().observations).toBe('Confirmada no banco');
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

describe('owned transaction changes', () => {
  it('updates editable details and persists the expected version', async () => {
    const repository = new RecordingTransactions();
    await new CreateTransactionUseCase(
      repository,
      accounts(),
      { now: (): Date => new Date('2026-09-20T13:00:00.000Z') },
      { generate: (): string => 'transaction-id' },
    ).execute({
      accountId: 'account-id',
      actorId: 'owner-id',
      amount: '12.34',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      kind: 'income',
      occurredAt: new Date('2026-09-20T11:00:00.000Z'),
    });
    const update = new UpdateOwnedTransactionUseCase(repository, accounts(), {
      now: (): Date => new Date('2026-09-20T14:00:00.000Z'),
    });

    const result = await update.execute({
      actorId: 'owner-id',
      amount: '9.99',
      description: 'Corrigida',
      kind: 'expense',
      observations: 'Conferida no extrato',
      occurredAt: new Date('2026-09-19T11:00:00.000Z'),
      transactionId: 'transaction-id',
    });

    expect(result.toSnapshot()).toMatchObject({
      kind: 'expense',
      observations: 'Conferida no extrato',
      version: 2,
    });
    expect(result.amount.toDecimal()).toBe('9.99');
  });

  it('moves an owned record to trash and removes its balance effect', async () => {
    const repository = new RecordingTransactions();
    await new CreateTransactionUseCase(
      repository,
      accounts(),
      { now: (): Date => new Date('2026-09-20T13:00:00.000Z') },
      { generate: (): string => 'transaction-id' },
    ).execute({
      accountId: 'account-id',
      actorId: 'owner-id',
      amount: '12.34',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      kind: 'income',
      occurredAt: new Date('2026-09-20T11:00:00.000Z'),
    });
    const change = new ChangeOwnedTransactionLifecycleUseCase(repository, {
      now: (): Date => new Date('2026-09-20T14:00:00.000Z'),
    });

    const result = await change.execute({
      action: 'move-to-trash',
      actorId: 'owner-id',
      transactionId: 'transaction-id',
    });

    expect(result.balanceEffect().isZero()).toBe(true);
  });
});
