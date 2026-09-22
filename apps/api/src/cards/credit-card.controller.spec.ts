import type { CreateCreditCardUseCase } from '@seshat/application';
import { CreditCard, Currency, Money } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { CreditCardController } from './credit-card.controller.js';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

describe('CreditCardController', () => {
  it('derives ownership from the verified actor and hides the owner identifier', async () => {
    const actors = new AuthenticatedActorContext();
    const card = CreditCard.create({
      brand: 'Visa',
      closingDay: 28,
      createdAt: new Date('2026-09-22T18:00:00.000Z'),
      dueDay: 7,
      id: 'c722103a-e28a-482c-b6e9-e3320d8a44e3',
      limit: Money.fromDecimal('3500.00', Currency.create('BRL', 2)),
      name: 'Cartão principal',
      ownerId: 'actor-id',
      paymentAccountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    });
    const execute = vi.fn().mockResolvedValue(card);
    const controller = new CreditCardController(
      { execute } as unknown as CreateCreditCardUseCase,
      actors,
    );

    const response = await controller.create(request(actors), {
      brand: 'Visa',
      closingDay: 28,
      currencyCode: 'BRL',
      currencyMinorUnitScale: 2,
      dueDay: 7,
      limit: '3500.00',
      name: 'Cartão principal',
      paymentAccountId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor-id' }),
    );
    expect(response).toMatchObject({
      closingDay: 28,
      currencyCode: 'BRL',
      dueDay: 7,
      limit: '3500.00',
    });
    expect(response).not.toHaveProperty('ownerId');
  });
});
