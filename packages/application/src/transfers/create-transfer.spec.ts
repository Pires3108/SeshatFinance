import {
  Account,
  AccountType,
  Currency,
  Money,
  type Transfer,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { AccountRepository } from '../accounts/create-account.js';
import {
  CreateTransferUseCase,
  TransferAccountUnavailableError,
  TransferCurrencyMismatchError,
  type CreateTransferCommand,
  type TransferRepository,
} from './create-transfer.js';

const ownerId = 'owner-id';
const currency = Currency.create('BRL', 2);

function account(id: string, selectedCurrency = currency): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-21T10:00:00.000Z'),
    description: null,
    icon: null,
    id,
    initialBalance: Money.fromDecimal('0', selectedCurrency),
    institution: null,
    name: id,
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

function accounts(values: readonly Account[]): AccountRepository {
  return {
    findByIdForOwner: (id, actorId) =>
      Promise.resolve(
        values.find((value) => value.id === id && value.ownerId === actorId) ??
          null,
      ),
    insert: () => Promise.resolve(),
    listForOwner: () => Promise.resolve(values),
    save: () => Promise.resolve(true),
  };
}

function command(): CreateTransferCommand {
  return {
    actorId: ownerId,
    amount: '50.25',
    currencyCode: 'BRL',
    currencyMinorUnitScale: 2,
    description: 'Transferência declarada',
    destinationAccountId: 'destination-id',
    observations: null,
    occurredAt: new Date('2026-09-21T11:00:00.000Z'),
    sourceAccountId: 'source-id',
  };
}

describe('CreateTransferUseCase', () => {
  it('persists both sides through one atomic repository call', async () => {
    let inserted: Transfer | undefined;
    const repository: TransferRepository = {
      insertAtomically: (transfer) => {
        inserted = transfer;
        return Promise.resolve();
      },
    };
    const identifiers = [
      'transfer-id',
      'source-entry-id',
      'destination-entry-id',
    ];
    const useCase = new CreateTransferUseCase(
      accounts([account('source-id'), account('destination-id')]),
      repository,
      { now: () => new Date('2026-09-21T12:00:00.000Z') },
      { generate: () => identifiers.shift() ?? 'unexpected-id' },
    );

    const result = await useCase.execute(command());

    expect(inserted).toBe(result);
    expect(result.toSnapshot()).toMatchObject({
      destination: { id: 'destination-entry-id', kind: 'income' },
      id: 'transfer-id',
      source: { id: 'source-entry-id', kind: 'expense' },
    });
    expect(result.netBalanceEffect().toDecimal()).toBe('0.00');
  });

  it('rejects a missing or foreign account', async () => {
    const useCase = new CreateTransferUseCase(
      accounts([account('source-id')]),
      { insertAtomically: () => Promise.resolve() },
      { now: () => new Date('2026-09-21T12:00:00.000Z') },
      { generate: () => 'id' },
    );

    await expect(useCase.execute(command())).rejects.toBeInstanceOf(
      TransferAccountUnavailableError,
    );
  });

  it('rejects accounts with different currencies before persistence', async () => {
    const useCase = new CreateTransferUseCase(
      accounts([
        account('source-id'),
        account('destination-id', Currency.create('USD', 2)),
      ]),
      { insertAtomically: () => Promise.resolve() },
      { now: () => new Date('2026-09-21T12:00:00.000Z') },
      { generate: () => 'id' },
    );

    await expect(useCase.execute(command())).rejects.toBeInstanceOf(
      TransferCurrencyMismatchError,
    );
  });
});
