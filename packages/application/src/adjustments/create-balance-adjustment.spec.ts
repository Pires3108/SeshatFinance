import {
  Account,
  AccountType,
  Currency,
  Money,
  Transaction,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { AccountRepository } from '../accounts/create-account.js';
import type { TransactionRepository } from '../transactions/create-transaction.js';
import {
  BalanceAdjustmentAccountUnavailableError,
  BalanceAdjustmentBalanceConflictError,
  CreateBalanceAdjustmentUseCase,
  type BalanceAdjustmentRepository,
} from './create-balance-adjustment.js';

const currency = Currency.create('BRL', 2);
const ownerId = 'owner-id';

function accountRepository(value: Account | null): AccountRepository {
  return {
    findByIdForOwner: () => Promise.resolve(value),
    insert: () => Promise.resolve(),
    listForOwner: () => Promise.resolve(value === null ? [] : [value]),
    save: () => Promise.resolve(true),
  };
}

function transactionRepository(
  values: readonly Transaction[],
): TransactionRepository {
  return {
    findByIdForOwner: () => Promise.resolve(null),
    insert: () => Promise.resolve(),
    listForAccountOwner: () => Promise.resolve(values),
    save: () => Promise.resolve(true),
  };
}

function activeAccount(): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-21T10:00:00.000Z'),
    description: null,
    icon: null,
    id: 'account-id',
    initialBalance: Money.fromDecimal('100.00', currency),
    institution: null,
    name: 'Conta',
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

describe('CreateBalanceAdjustmentUseCase', () => {
  it('records the calculated previous balance and closes the difference', async () => {
    const existing = Transaction.create({
      accountId: 'account-id',
      amount: Money.fromDecimal('15.00', currency),
      createdAt: new Date('2026-09-21T10:00:00.000Z'),
      description: null,
      id: 'existing-id',
      kind: 'expense',
      occurredAt: new Date('2026-09-21T10:00:00.000Z'),
      ownerId,
    });
    let captured:
      | Parameters<BalanceAdjustmentRepository['insertAtomically']>[0]
      | undefined;
    const adjustments: BalanceAdjustmentRepository = {
      insertAtomically: (adjustment) => {
        captured = adjustment;
        return Promise.resolve(true);
      },
    };
    const ids = ['adjustment-id', 'transaction-id'];
    const useCase = new CreateBalanceAdjustmentUseCase(
      accountRepository(activeAccount()),
      transactionRepository([existing]),
      adjustments,
      { now: () => new Date('2026-09-21T12:00:00.000Z') },
      { generate: () => ids.shift() ?? 'unexpected-id' },
    );

    const result = await useCase.execute({
      accountId: 'account-id',
      actorId: ownerId,
      justification: 'Conferência do extrato',
      occurredAt: new Date('2026-09-21T11:00:00.000Z'),
      reportedBalance: '92.50',
    });

    expect(captured).toBe(result);
    expect(result.toSnapshot()).toMatchObject({
      difference: { amount: '7.50' },
      previousBalance: { amount: '85.00' },
      reportedBalance: { amount: '92.50' },
      transaction: { kind: 'income' },
    });
  });

  it('rejects a missing or foreign account', async () => {
    const useCase = new CreateBalanceAdjustmentUseCase(
      accountRepository(null),
      transactionRepository([]),
      { insertAtomically: () => Promise.resolve(true) },
      { now: () => new Date() },
      { generate: () => 'id' },
    );

    await expect(
      useCase.execute({
        accountId: 'account-id',
        actorId: ownerId,
        justification: 'Conferência',
        occurredAt: new Date(),
        reportedBalance: '10.00',
      }),
    ).rejects.toBeInstanceOf(BalanceAdjustmentAccountUnavailableError);
  });

  it('reports a conflict when the balance changes before the atomic insert', async () => {
    const useCase = new CreateBalanceAdjustmentUseCase(
      accountRepository(activeAccount()),
      transactionRepository([]),
      { insertAtomically: () => Promise.resolve(false) },
      { now: () => new Date('2026-09-21T12:00:00.000Z') },
      { generate: () => 'id' },
    );

    await expect(
      useCase.execute({
        accountId: 'account-id',
        actorId: ownerId,
        justification: 'Conferência',
        occurredAt: new Date('2026-09-21T11:00:00.000Z'),
        reportedBalance: '110.00',
      }),
    ).rejects.toBeInstanceOf(BalanceAdjustmentBalanceConflictError);
  });
});
