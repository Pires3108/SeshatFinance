import type {
  CreateTransactionUseCase,
  GetOwnedTransactionUseCase,
  ListOwnedAccountTransactionsUseCase,
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
      actors,
    );

    await controller.list(
      request(actors),
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    );

    expect(execute).toHaveBeenCalledWith(
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      'actor-id',
    );
  });
});
