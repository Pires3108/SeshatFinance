import type {
  CreateCreditCardUseCase,
  GetCreditCardCycleUseCase,
  GetOwnedCreditCardUseCase,
  ListOwnedCreditCardsUseCase,
  UpdateCreditCardUseCase,
} from '@seshat/application';
import { CivilDate, CreditCard, Currency, Money } from '@seshat/domain';
import {
  CreditCardNotFoundError,
  CreditCardVersionConflictError,
} from '@seshat/application';
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
      { execute: vi.fn() } as unknown as UpdateCreditCardUseCase,
      { execute: vi.fn() } as unknown as GetCreditCardCycleUseCase,
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
      { execute: vi.fn() } as unknown as UpdateCreditCardUseCase,
      { execute: vi.fn() } as unknown as GetCreditCardCycleUseCase,
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

  it('updates settings for the verified actor and maps conflicts to 409', async () => {
    const actors = new AuthenticatedActorContext();
    const card = sampleCard().update({
      brand: 'Master',
      closingBoundary: 'closing-cycle',
      closingDay: 5,
      dueDay: 15,
      limit: Money.fromDecimal('5000.00', Currency.create('BRL', 2)),
      name: 'Cartão viagem',
    });
    const execute = vi.fn().mockResolvedValue(card);
    const controller = controllerWith(actors, { update: execute });
    const body = {
      brand: 'Master',
      closingBoundary: 'closing-cycle',
      closingDay: 5,
      dueDay: 15,
      expectedVersion: 1,
      limit: '5000.00',
      name: 'Cartão viagem',
    } as const;

    const response = await controller.update(request(actors), card.id, body);

    expect(execute).toHaveBeenCalledWith({
      actorId: 'actor-id',
      cardId: card.id,
      ...body,
    });
    expect(response).toMatchObject({
      closingBoundary: 'closing-cycle',
      version: 2,
    });
    expect(response).not.toHaveProperty('ownerId');
    execute.mockRejectedValueOnce(new CreditCardVersionConflictError());
    await expect(
      controller.update(request(actors), card.id, body),
    ).rejects.toMatchObject({ status: 409 });
    execute.mockRejectedValueOnce(new CreditCardNotFoundError());
    await expect(
      controller.update(request(actors), card.id, body),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns the cycle as civil dates for the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const card = sampleCard();
    const execute = vi.fn().mockResolvedValue({
      card,
      cycle: card.cycleSchedule.cycleFor(
        CivilDate.parse('2026-10-27'),
        () => false,
      ),
      holidayDatasetVersion: 'v1',
      purchaseDate: CivilDate.parse('2026-10-27'),
      timeZone: 'America/Sao_Paulo',
    });
    const controller = controllerWith(actors, { cycle: execute });

    await expect(
      controller.cycle(request(actors), card.id, {
        at: '2026-10-27T12:00:00.000Z',
      }),
    ).resolves.toEqual({
      cardId: card.id,
      closesOn: '2026-10-28',
      configurationPending: false,
      dueOn: '2026-11-09',
      firstPurchaseDate: '2026-09-28',
      holidayDatasetVersion: 'v1',
      lastPurchaseDate: '2026-10-27',
      purchaseDate: '2026-10-27',
      scheduledDueOn: '2026-11-07',
      timeZone: 'America/Sao_Paulo',
    });
    expect(execute).toHaveBeenCalledWith({
      actorId: 'actor-id',
      at: new Date('2026-10-27T12:00:00.000Z'),
      cardId: card.id,
    });
  });
});

function sampleCard(): CreditCard {
  return CreditCard.create({
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
}

function controllerWith(
  actors: AuthenticatedActorContext,
  mocks: { update?: unknown; cycle?: unknown },
): CreditCardController {
  return new CreditCardController(
    { execute: vi.fn() } as unknown as CreateCreditCardUseCase,
    { execute: vi.fn() } as unknown as GetOwnedCreditCardUseCase,
    { execute: vi.fn() } as unknown as ListOwnedCreditCardsUseCase,
    { execute: mocks.update ?? vi.fn() } as unknown as UpdateCreditCardUseCase,
    { execute: mocks.cycle ?? vi.fn() } as unknown as GetCreditCardCycleUseCase,
    actors,
  );
}
