import {
  CreditCardNotFoundError,
  GetCreditCardCycleUseCase,
  GetOwnedCreditCardUseCase,
  RemoveDeclaredHolidayUseCase,
  UpdateCreditCardUseCase,
  ResolveAuthenticatedActorUseCase,
} from '@seshat/application';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const cardOwnedByAnotherActor = '7943309c-9c98-41d4-aa61-4811b12633f5';
const authenticatedActorId = 'actor-b';

describe('Credit card HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const getCard = {
    execute: vi
      .fn<GetOwnedCreditCardUseCase['execute']>()
      .mockResolvedValue(null),
  };

  const updateCard = {
    execute: vi
      .fn<UpdateCreditCardUseCase['execute']>()
      .mockRejectedValue(new CreditCardNotFoundError()),
  };
  const getCycle = {
    execute: vi
      .fn<GetCreditCardCycleUseCase['execute']>()
      .mockRejectedValue(new CreditCardNotFoundError()),
  };
  const removeHoliday = {
    execute: vi
      .fn<RemoveDeclaredHolidayUseCase['execute']>()
      .mockResolvedValue(false),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    getCard.execute.mockClear();
    updateCard.execute.mockClear();
    getCycle.execute.mockClear();
    removeHoliday.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(GetOwnedCreditCardUseCase)
      .useValue(getCard)
      .overrideProvider(UpdateCreditCardUseCase)
      .useValue(updateCard)
      .overrideProvider(GetCreditCardCycleUseCase)
      .useValue(getCycle)
      .overrideProvider(RemoveDeclaredHolidayUseCase)
      .useValue(removeHoliday)
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
  });

  afterEach(async (): Promise<void> => {
    await application.close();
  });

  it('does not reveal another actor credit card', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/credit-cards/${cardOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(getCard.execute).toHaveBeenCalledWith(
      cardOwnedByAnotherActor,
      authenticatedActorId,
    );
  });

  it('does not update another actor credit card', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: {
        brand: 'Visa',
        closingBoundary: 'next-cycle',
        closingDay: 28,
        dueDay: 7,
        expectedVersion: 1,
        limit: '1000.00',
        name: 'Cartão',
      },
      url: `/api/v1/credit-cards/${cardOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(404);
    expect(updateCard.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: authenticatedActorId,
        cardId: cardOwnedByAnotherActor,
      }),
    );
  });

  it('rejects an invalid closing boundary before reaching the use case', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: {
        brand: 'Visa',
        closingBoundary: 'sometimes',
        closingDay: 28,
        dueDay: 7,
        expectedVersion: 1,
        limit: '1000.00',
        name: 'Cartão',
      },
      url: `/api/v1/credit-cards/${cardOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(400);
    expect(updateCard.execute).not.toHaveBeenCalled();
  });

  it('does not reveal the cycle of another actor credit card', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/credit-cards/${cardOwnedByAnotherActor}/cycle?at=2026-10-27T12:00:00.000Z`,
    });

    expect(response.statusCode).toBe(404);
    expect(getCycle.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      at: new Date('2026-10-27T12:00:00.000Z'),
      cardId: cardOwnedByAnotherActor,
    });
  });

  it('does not remove another actor declared holiday', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'DELETE',
      url: `/api/v1/users/me/holiday-settings/declared/${cardOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(404);
    expect(removeHoliday.execute).toHaveBeenCalledWith(
      cardOwnedByAnotherActor,
      authenticatedActorId,
    );
  });

  it('requires authentication for holiday settings', async () => {
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/users/me/holiday-settings',
    });

    expect(response.statusCode).toBe(401);
  });
});
