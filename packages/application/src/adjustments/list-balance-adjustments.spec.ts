import { Account, AccountType, Currency, Money } from '@seshat/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  OwnedAccountNotFoundError,
  type AccountRepository,
} from '../accounts/create-account.js';
import { ListOwnedBalanceAdjustmentsUseCase } from './list-balance-adjustments.js';

const accountId = '7c2c7a54-73fe-49a3-b0ea-19034bf22baf';
const ownerId = 'b36bfe2a-f319-49a8-aade-2a536ea3af38';

function ownedAccount(): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-21T10:00:00.000Z'),
    description: null,
    icon: null,
    id: accountId,
    initialBalance: Money.fromDecimal('100.00', Currency.create('BRL', 2)),
    institution: null,
    name: 'Conta de teste',
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

describe('ListOwnedBalanceAdjustmentsUseCase', () => {
  it('uses the verified owner and returns the historical values', async () => {
    const account = ownedAccount();
    const listForAccountOwner = vi
      .fn()
      .mockResolvedValue([{ id: 'adjustment-id' }]);
    const useCase = new ListOwnedBalanceAdjustmentsUseCase(
      {
        findByIdForOwner: (id, actorId) =>
          Promise.resolve(
            id === account.id && actorId === account.ownerId ? account : null,
          ),
      } as AccountRepository,
      { listForAccountOwner },
    );

    await expect(useCase.execute(accountId, ownerId)).resolves.toEqual([
      { id: 'adjustment-id' },
    ]);
    expect(listForAccountOwner).toHaveBeenCalledWith(accountId, ownerId);
  });

  it('does not query adjustments for a foreign account', async () => {
    const listForAccountOwner = vi.fn();
    const useCase = new ListOwnedBalanceAdjustmentsUseCase(
      {
        findByIdForOwner: () => Promise.resolve(null),
      } as unknown as AccountRepository,
      { listForAccountOwner },
    );

    await expect(useCase.execute(accountId, 'foreign-owner')).rejects.toThrow(
      OwnedAccountNotFoundError,
    );
    expect(listForAccountOwner).not.toHaveBeenCalled();
  });
});
