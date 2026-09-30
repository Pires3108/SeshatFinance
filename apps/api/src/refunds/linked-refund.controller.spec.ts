import type {
  GetOwnedLinkedRefundsUseCase,
  GetOwnUserProfileUseCase,
  RecordLinkedRefundUseCase,
} from '@seshat/application';
import { Currency, Money, Transaction } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { LinkedRefundController } from './linked-refund.controller.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const expenseId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const currency = Currency.create('BRL', 2);

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: actorId });
  return value;
}

function entry(): Transaction {
  return Transaction.create({
    accountId,
    amount: Money.fromDecimal('40.00', currency),
    createdAt: new Date('2026-09-29T12:00:00.000Z'),
    description: null,
    id: '55555555-5555-4555-8555-555555555555',
    kind: 'income',
    occurredAt: new Date('2026-09-29T11:00:00.000Z'),
    ownerId: actorId,
  });
}

describe('LinkedRefundController', () => {
  it('uses the verified actor and idempotency key when recording', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue({
      id: key,
      expenseTransactionId: expenseId,
      entry: entry(),
      kind: 'refund',
      compensatesRefundId: null,
      reason: null,
      createdAt: new Date('2026-09-29T12:00:00.000Z'),
    });
    const controller = new LinkedRefundController(
      { execute } as unknown as RecordLinkedRefundUseCase,
      { getForExpense: vi.fn() } as unknown as GetOwnedLinkedRefundsUseCase,
      { execute: vi.fn() } as unknown as GetOwnUserProfileUseCase,
      actors,
    );
    const response = await controller.create(request(actors), expenseId, key, {
      accountId,
      amount: '40.00',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      description: null,
      occurredAt: '2026-09-29T11:00:00.000Z',
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        expenseTransactionId: expenseId,
        idempotencyKey: key,
      }),
    );
    expect(response.amount).toBe('40.00');
  });

  it('presents the same net value in either display mode', async () => {
    const actors = new AuthenticatedActorContext();
    const getForExpense = vi.fn().mockResolvedValue({
      expenseTransactionId: expenseId,
      summary: {
        gross: Money.fromDecimal('100.00', currency),
        refunded: Money.fromDecimal('40.00', currency),
        net: Money.fromDecimal('60.00', currency),
      },
      entries: [],
    });
    const controller = new LinkedRefundController(
      { execute: vi.fn() } as unknown as RecordLinkedRefundUseCase,
      { getForExpense } as unknown as GetOwnedLinkedRefundsUseCase,
      {
        execute: vi
          .fn()
          .mockResolvedValue({ refundPresentation: 'expense-offset' }),
      } as unknown as GetOwnUserProfileUseCase,
      actors,
    );
    const separate = await controller.list(
      request(actors),
      expenseId,
      'separate-income',
    );
    const offset = await controller.list(
      request(actors),
      expenseId,
      'expense-offset',
    );
    const saved = await controller.list(request(actors), expenseId, undefined);
    expect(getForExpense).toHaveBeenCalledWith(expenseId, actorId);
    expect(separate).toMatchObject({
      net: '60.00',
      displayedExpense: '100.00',
      displayedRefundIncome: '40.00',
    });
    expect(offset).toMatchObject({
      net: '60.00',
      displayedExpense: '60.00',
      displayedRefundIncome: '0.00',
    });
    expect(saved.presentation).toBe('expense-offset');
  });
});
