import {
  OwnedAccountNotFoundError,
  type CreateBalanceAdjustmentUseCase,
  type ListOwnedBalanceAdjustmentsUseCase,
} from '@seshat/application';
import { BalanceAdjustment, Currency, Money } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BalanceAdjustmentController } from './balance-adjustment.controller.js';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

function adjustment(): BalanceAdjustment {
  const currency = Currency.create('BRL', 2);
  return BalanceAdjustment.create({
    accountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    createdAt: new Date('2026-09-21T12:00:00.000Z'),
    id: 'c722103a-e28a-482c-b6e9-e3320d8a44e3',
    justification: 'Conferência do extrato',
    occurredAt: new Date('2026-09-21T11:00:00.000Z'),
    ownerId: 'actor-id',
    previousBalance: Money.fromDecimal('100.00', currency),
    reportedBalance: Money.fromDecimal('95.50', currency),
    transactionId: '86684068-45d9-4e14-b454-f7e556b867e7',
  });
}

describe('BalanceAdjustmentController', () => {
  it('derives ownership from the verified actor and maps audit values', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(adjustment());
    const controller = new BalanceAdjustmentController(
      { execute } as unknown as CreateBalanceAdjustmentUseCase,
      { execute: vi.fn() } as unknown as ListOwnedBalanceAdjustmentsUseCase,
      actors,
    );

    const response = await controller.create(
      request(actors),
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      {
        justification: 'Conferência do extrato',
        occurredAt: '2026-09-21T11:00:00.000Z',
        reportedBalance: '95.50',
      },
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor-id' }),
    );
    expect(response).toMatchObject({
      difference: '-4.50',
      previousBalance: '100.00',
      reportedBalance: '95.50',
      transactionKind: 'expense',
    });
    expect(response).not.toHaveProperty('ownerId');
  });

  it('returns the owned reconciliation history without exposing the owner', async () => {
    const actors = new AuthenticatedActorContext();
    const currency = Currency.create('BRL', 2);
    const execute = vi.fn().mockResolvedValue([
      {
        accountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
        createdAt: new Date('2026-09-21T12:00:00.000Z'),
        difference: Money.fromDecimal('-4.50', currency),
        id: 'c722103a-e28a-482c-b6e9-e3320d8a44e3',
        justification: 'Conferência do extrato',
        occurredAt: new Date('2026-09-21T11:00:00.000Z'),
        previousBalance: Money.fromDecimal('100.00', currency),
        reportedBalance: Money.fromDecimal('95.50', currency),
        transactionId: '86684068-45d9-4e14-b454-f7e556b867e7',
        transactionKind: 'expense',
      },
    ]);
    const controller = new BalanceAdjustmentController(
      { execute: vi.fn() } as unknown as CreateBalanceAdjustmentUseCase,
      { execute } as unknown as ListOwnedBalanceAdjustmentsUseCase,
      actors,
    );

    const response = await controller.list(
      request(actors),
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    );

    expect(execute).toHaveBeenCalledWith(
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      'actor-id',
    );
    expect(response[0]).toMatchObject({
      difference: '-4.50',
      previousBalance: '100.00',
      reportedBalance: '95.50',
    });
    expect(response[0]).not.toHaveProperty('ownerId');
    execute.mockRejectedValueOnce(new OwnedAccountNotFoundError());
    await expect(
      controller.list(request(actors), '7c2c7a54-73fe-49a3-b0ea-19034bf22baf'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
