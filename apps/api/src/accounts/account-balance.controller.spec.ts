import type { GetOwnedAccountBalanceUseCase } from '@seshat/application';
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
});
