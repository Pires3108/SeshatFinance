import type {
  GetOwnedAccountBalanceUseCase,
  GetOwnedBalanceSummaryUseCase,
} from '@seshat/application';
import { Currency, Money } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { AccountBalanceController } from './account-balance.controller.js';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

describe('AccountBalanceController', () => {
  it('calculates the balance for the verified account owner', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi
      .fn()
      .mockResolvedValue(
        Money.fromDecimal('125.10', Currency.create('BRL', 2)),
      );
    const controller = new AccountBalanceController(
      { execute } as unknown as GetOwnedAccountBalanceUseCase,
      { execute: vi.fn() } as unknown as GetOwnedBalanceSummaryUseCase,
      actors,
    );

    const result = await controller.get(
      request(actors),
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    );

    expect(execute).toHaveBeenCalledWith(
      '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      'actor-id',
    );
    expect(result).toEqual({
      amount: '125.10',
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
    });
  });

  it('reports unavailable BRL consolidation while preserving original currencies', async () => {
    const actors = new AuthenticatedActorContext();
    const usd = Money.fromDecimal('10.25', Currency.create('USD', 2));
    const execute = vi.fn().mockResolvedValue({
      accountBalances: [{ accountId: 'account-id', balance: usd }],
      brlConsolidation: {
        reason: 'conversion-policy-pending',
        status: 'unavailable',
      },
      totalsByCurrency: [usd],
    });
    const controller = new AccountBalanceController(
      { execute: vi.fn() } as unknown as GetOwnedAccountBalanceUseCase,
      { execute } as unknown as GetOwnedBalanceSummaryUseCase,
      actors,
    );

    await expect(controller.consolidation(request(actors))).resolves.toEqual({
      accountBalances: [
        {
          accountId: 'account-id',
          amount: '10.25',
          currencyCode: 'USD',
          currencyMinorUnitScale: 2,
        },
      ],
      brlConsolidation: {
        reason: 'conversion-policy-pending',
        status: 'unavailable',
      },
      totalsByCurrency: [
        { amount: '10.25', currencyCode: 'USD', currencyMinorUnitScale: 2 },
      ],
    });
    expect(execute).toHaveBeenCalledWith('actor-id');
  });
});
