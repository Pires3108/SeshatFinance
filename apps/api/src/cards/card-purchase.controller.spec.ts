import type { RegisterCardPurchaseUseCase } from '@seshat/application';
import { CardPurchase, Currency, Money } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { CardPurchaseController } from './card-purchase.controller.js';

const cardId = '22222222-2222-4222-8222-222222222222';
const at = new Date('2026-10-05T12:00:00.000Z');

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: '99999999-9999-4999-8999-999999999999' });
  return value;
}

describe('CardPurchaseController', () => {
  it('records an external purchase for the authenticated owner without exposing ownership', async () => {
    const actors = new AuthenticatedActorContext();
    const purchase = CardPurchase.create({
      amount: Money.fromDecimal('10.50', Currency.create('BRL', 2)),
      cardId,
      createdAt: at,
      description: 'Synthetic purchase',
      id: crypto.randomUUID(),
      occurredAt: at,
      ownerId: '99999999-9999-4999-8999-999999999999',
    });
    const execute = vi.fn().mockResolvedValue({ purchase, replayed: false });
    const controller = new CardPurchaseController(
      { execute } as unknown as RegisterCardPurchaseUseCase,
      actors,
    );
    const result = await controller.create(
      request(actors),
      cardId,
      'request-key',
      {
        amount: '10.50',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: 'Synthetic purchase',
        occurredAt: at.toISOString(),
      },
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: '99999999-9999-4999-8999-999999999999',
        cardId,
        idempotencyKey: 'request-key',
      }),
    );
    expect(result).toMatchObject({ amount: '10.50', cardId, replayed: false });
    expect(result).not.toHaveProperty('ownerId');
  });

  it('requires an idempotency key before writing', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn();
    const controller = new CardPurchaseController(
      { execute } as unknown as RegisterCardPurchaseUseCase,
      actors,
    );
    await expect(
      controller.create(request(actors), cardId, undefined, {
        amount: '10.50',
        currencyCode: 'BRL',
        currencyMinorUnitScale: 2,
        description: 'Synthetic purchase',
        occurredAt: at.toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(execute).not.toHaveBeenCalled();
  });
});
