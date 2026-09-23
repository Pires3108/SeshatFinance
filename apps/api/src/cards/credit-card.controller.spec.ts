import type {
  CreateCreditCardUseCase,
  GetOwnedCreditCardUseCase,
  ListOwnedCreditCardsUseCase,
} from '@seshat/application';
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
      { execute: vi.fn() } as unknown as GetOwnedCreditCardUseCase,
      { execute: vi.fn() } as unknown as ListOwnedCreditCardsUseCase,
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

  it('scopes reads to the verified actor and returns only public fields', async () => {
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
    const get = vi.fn().mockResolvedValue(card);
    const list = vi.fn().mockResolvedValue([card]);
    const controller = new CreditCardController(
      { execute: vi.fn() } as unknown as CreateCreditCardUseCase,
      { execute: get } as unknown as GetOwnedCreditCardUseCase,
      { execute: list } as unknown as ListOwnedCreditCardsUseCase,
      actors,
    );

    const item = await controller.get(request(actors), card.id);
    const items = await controller.list(request(actors));
    expect(get).toHaveBeenCalledWith(card.id, 'actor-id');
    expect(list).toHaveBeenCalledWith('actor-id');
    expect(item.limit).toBe('3500.00');
    expect(item).not.toHaveProperty('ownerId');
    expect(items).toEqual([item]);
    get.mockResolvedValueOnce(null);
    await expect(
      controller.get(request(actors), card.id),
    ).rejects.toMatchObject({ status: 404 });
  });
});
