import {
  CardPurchaseCurrencyMismatchError,
  CreditCardNotFoundError,
  IdempotencyConflictError,
  ListCardPurchasesUseCase,
  RegisterCardPurchaseUseCase,
  ResolveAuthenticatedActorUseCase,
} from '@seshat/application';
import { CardPurchase, CivilDate, Currency, Money } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const cardId = '7943309c-9c98-41d4-aa61-4811b12633f5';
const key = '6f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f';
const actorId = 'actor-b';
const headers = {
  authorization: 'Bearer actor-b-token',
  'idempotency-key': key,
};
const payload = {
  amount: '120.35',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  description: 'Mercado',
  occurredAt: '2026-10-20T14:00:00.000Z',
};

describe('Card purchase HTTP boundary', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const register = {
    execute: vi.fn<RegisterCardPurchaseUseCase['execute']>(),
  };
  const list = {
    execute: vi
      .fn<ListCardPurchasesUseCase['execute']>()
      .mockRejectedValue(new CreditCardNotFoundError()),
  };

  beforeEach(async (): Promise<void> => {
    register.execute.mockReset();
    list.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(RegisterCardPurchaseUseCase)
      .useValue(register)
      .overrideProvider(ListCardPurchasesUseCase)
      .useValue(list)
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

  it('records a purchase for the verified actor and returns its cycle', async () => {
    register.execute.mockResolvedValue(
      CardPurchase.create({
        amount: Money.fromDecimal('120.35', Currency.create('BRL', 2)),
        cardId,
        createdAt: new Date('2026-10-20T15:00:00.000Z'),
        cycleClosesOn: CivilDate.parse('2026-10-28'),
        description: 'Mercado',
        id: '0f6b0d3e-6a40-4a4f-9b5d-6f3e3f2a1b0c',
        occurredAt: new Date('2026-10-20T14:00:00.000Z'),
        ownerId: actorId,
      }),
    );

    const response = await application.inject({
      headers,
      method: 'POST',
      payload,
      url: `/api/v1/credit-cards/${cardId}/purchases`,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      amount: '120.35',
      cycleClosesOn: '2026-10-28',
    });
    expect(response.json()).not.toHaveProperty('ownerId');
    expect(register.execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, cardId, idempotencyKey: key }),
    );
  });

  it('requires an idempotency key before reaching the use case', async () => {
    const response = await application.inject({
      headers: { authorization: headers.authorization },
      method: 'POST',
      payload,
      url: `/api/v1/credit-cards/${cardId}/purchases`,
    });

    expect(response.statusCode).toBe(400);
    expect(register.execute).not.toHaveBeenCalled();
  });

  it.each([
    [new CreditCardNotFoundError(), 404, 'NOT_FOUND'],
    [new CardPurchaseCurrencyMismatchError(), 422, 'UNPROCESSABLE_REQUEST'],
    [new IdempotencyConflictError(), 409, 'CONFLICT'],
  ])('maps %s without leaking details', async (error, status, code) => {
    register.execute.mockRejectedValue(error);

    const response = await application.inject({
      headers,
      method: 'POST',
      payload,
      url: `/api/v1/credit-cards/${cardId}/purchases`,
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: { code } });
  });

  it('does not list purchases of another actor card', async () => {
    const response = await application.inject({
      headers: { authorization: headers.authorization },
      method: 'GET',
      url: `/api/v1/credit-cards/${cardId}/purchases?cycleClosesOn=2026-10-28`,
    });

    expect(response.statusCode).toBe(404);
    expect(list.execute).toHaveBeenCalledWith({
      actorId,
      cardId,
      cycleClosesOn: '2026-10-28',
    });
  });
});
