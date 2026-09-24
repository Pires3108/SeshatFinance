import type {
  ChangeOwnedTransactionLifecycleUseCase,
  CreateTransactionUseCase,
  GetOwnedTransactionUseCase,
  ListOwnedAccountTransactionsUseCase,
  ListOwnedTransactionsBetweenUseCase,
  UpdateOwnedTransactionUseCase,
} from '@seshat/application';
import { Currency, Money, Transaction } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { TransactionController } from './transaction.controller.js';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

function transaction(): Transaction {
  return Transaction.create({
    accountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    amount: Money.fromDecimal('10.25', Currency.create('BRL', 2)),
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    description: null,
    id: '86684068-45d9-4e14-b454-f7e556b867e7',
    kind: 'income',
    occurredAt: new Date('2026-09-20T11:00:00.000Z'),
    ownerId: 'actor-id',
  });
}

describe('TransactionController', () => {
  it('derives ownership from the verified actor when creating a record', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(transaction());
    const controller = new TransactionController(
      { execute } as unknown as CreateTransactionUseCase,
      { execute: vi.fn() } as unknown as GetOwnedTransactionUseCase,
      { execute: vi.fn() } as unknown as ListOwnedAccountTransactionsUseCase,
      { execute: vi.fn() } as unknown as ListOwnedTransactionsBetweenUseCase,
      { execute: vi.fn() } as unknown as UpdateOwnedTransactionUseCase,
      { execute: vi.fn() } as unknown as ChangeOwnedTransactionLifecycleUseCase,
      actors,
    );

    await controller.create(
      request(actors),
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      {
        amount: '10.25',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: null,
        kind: 'income',
        observations: 'Recorded after bank confirmation',
        occurredAt: '2026-09-20T11:00:00.000Z',
      },
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor-id' }),
    );
  });

  it('lists records using both account and verified actor identifiers', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue([transaction()]);
    const controller = new TransactionController(
      { execute: vi.fn() } as unknown as CreateTransactionUseCase,
      { execute: vi.fn() } as unknown as GetOwnedTransactionUseCase,
      { execute } as unknown as ListOwnedAccountTransactionsUseCase,
      { execute: vi.fn() } as unknown as ListOwnedTransactionsBetweenUseCase,
      { execute: vi.fn() } as unknown as UpdateOwnedTransactionUseCase,
      { execute: vi.fn() } as unknown as ChangeOwnedTransactionLifecycleUseCase,
      actors,
    );

    await controller.list(
      request(actors),
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      'trashed',
    );

    expect(execute).toHaveBeenCalledWith(
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      'actor-id',
      'trashed',
    );
  });

  it('lists an explicit instant range using only the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue([transaction()]);
    const controller = new TransactionController(
      { execute: vi.fn() } as unknown as CreateTransactionUseCase,
      { execute: vi.fn() } as unknown as GetOwnedTransactionUseCase,
      { execute: vi.fn() } as unknown as ListOwnedAccountTransactionsUseCase,
      { execute } as unknown as ListOwnedTransactionsBetweenUseCase,
      { execute: vi.fn() } as unknown as UpdateOwnedTransactionUseCase,
      { execute: vi.fn() } as unknown as ChangeOwnedTransactionLifecycleUseCase,
      actors,
    );

    await controller.listBetween(request(actors), {
      from: '2026-09-20T00:00:00.000Z',
      lifecycle: 'archived',
      to: '2026-09-21T00:00:00.000Z',
    });

    expect(execute).toHaveBeenCalledWith(
      'actor-id',
      new Date('2026-09-20T00:00:00.000Z'),
      new Date('2026-09-21T00:00:00.000Z'),
      'archived',
    );
  });

  it('updates a record using the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(transaction());
    const controller = new TransactionController(
      { execute: vi.fn() } as unknown as CreateTransactionUseCase,
      { execute: vi.fn() } as unknown as GetOwnedTransactionUseCase,
      { execute: vi.fn() } as unknown as ListOwnedAccountTransactionsUseCase,
      { execute: vi.fn() } as unknown as ListOwnedTransactionsBetweenUseCase,
      { execute } as unknown as UpdateOwnedTransactionUseCase,
      { execute: vi.fn() } as unknown as ChangeOwnedTransactionLifecycleUseCase,
      actors,
    );

    await controller.update(
      request(actors),
      '86684068-45d9-4e14-b454-f7e556b867e7',
      {
        amount: '9.99',
        description: null,
        kind: 'expense',
        observations: null,
        occurredAt: '2026-09-20T11:00:00.000Z',
      },
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-id',
        transactionId: '86684068-45d9-4e14-b454-f7e556b867e7',
      }),
    );
  });

  it('changes record lifecycle using the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(transaction());
    const controller = new TransactionController(
      { execute: vi.fn() } as unknown as CreateTransactionUseCase,
      { execute: vi.fn() } as unknown as GetOwnedTransactionUseCase,
      { execute: vi.fn() } as unknown as ListOwnedAccountTransactionsUseCase,
      { execute: vi.fn() } as unknown as ListOwnedTransactionsBetweenUseCase,
      { execute: vi.fn() } as unknown as UpdateOwnedTransactionUseCase,
      { execute } as unknown as ChangeOwnedTransactionLifecycleUseCase,
      actors,
    );
    await controller.lifecycle(
      request(actors),
      '86684068-45d9-4e14-b454-f7e556b867e7',
      { action: 'archive' },
    );
    expect(execute).toHaveBeenCalledWith({
      action: 'archive',
      actorId: 'actor-id',
      transactionId: '86684068-45d9-4e14-b454-f7e556b867e7',
    });
  });
});
