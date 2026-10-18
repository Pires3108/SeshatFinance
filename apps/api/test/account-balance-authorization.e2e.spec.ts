import {
  GetOwnedAccountBalanceUseCase,
  GetOwnedBalanceSummaryUseCase,
  OwnedAccountNotFoundError,
  ResolveAuthenticatedActorUseCase,
} from '@seshat/application';
import { Currency, Money } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const accountOwnedByAnotherActor = 'c8f22568-d17c-44d1-849d-46a41f8a2a94';
const authenticatedActorId = 'actor-b';

describe('Account balance HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const getBalance = {
    execute: vi
      .fn<GetOwnedAccountBalanceUseCase['execute']>()
      .mockRejectedValue(new OwnedAccountNotFoundError()),
  };
  const getSummary = {
    execute: vi
      .fn<GetOwnedBalanceSummaryUseCase['execute']>()
      .mockResolvedValue({
        accountBalances: [],
        brlConsolidation: {
          reason: 'conversion-policy-pending',
          status: 'unavailable',
        },
        totalsByCurrency: [
          Money.fromDecimal('10.25', Currency.create('USD', 2)),
        ],
      }),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    getBalance.execute.mockClear();
    getSummary.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(GetOwnedAccountBalanceUseCase)
      .useValue(getBalance)
      .overrideProvider(GetOwnedBalanceSummaryUseCase)
      .useValue(getSummary)
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

  it('does not reveal another actor account balance', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/accounts/${accountOwnedByAnotherActor}/balance`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(getBalance.execute).toHaveBeenCalledWith(
      accountOwnedByAnotherActor,
      authenticatedActorId,
    );
  });

  it('requires an actor and returns explicit unavailable consolidation', async () => {
    const anonymous = await application.inject({
      method: 'GET',
      url: '/api/v1/accounts/consolidation',
    });
    expect(anonymous.statusCode).toBe(401);
    expect(getSummary.execute).not.toHaveBeenCalled();

    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: '/api/v1/accounts/consolidation',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accountBalances: [],
      brlConsolidation: {
        reason: 'conversion-policy-pending',
        status: 'unavailable',
      },
      totalsByCurrency: [
        { amount: '10.25', currencyCode: 'USD', currencyMinorUnitScale: 2 },
      ],
    });
    expect(getSummary.execute).toHaveBeenCalledWith(authenticatedActorId);
  });
});
