import {
  BalanceAdjustmentAccountUnavailableError,
  CreateBalanceAdjustmentUseCase,
  ListOwnedBalanceAdjustmentsUseCase,
  OwnedAccountNotFoundError,
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

const accountOwnedByAnotherActor = 'c8f22568-d17c-44d1-849d-46a41f8a2a94';
const authenticatedActorId = 'actor-b';

describe('Balance adjustment HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const listAdjustments = {
    execute: vi
      .fn<ListOwnedBalanceAdjustmentsUseCase['execute']>()
      .mockRejectedValue(new OwnedAccountNotFoundError()),
  };
  const createAdjustment = {
    execute: vi
      .fn<CreateBalanceAdjustmentUseCase['execute']>()
      .mockRejectedValue(new BalanceAdjustmentAccountUnavailableError()),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    listAdjustments.execute.mockClear();
    createAdjustment.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(ListOwnedBalanceAdjustmentsUseCase)
      .useValue(listAdjustments)
      .overrideProvider(CreateBalanceAdjustmentUseCase)
      .useValue(createAdjustment)
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

  it('does not reveal another actor balance-adjustment history', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/accounts/${accountOwnedByAnotherActor}/balance-adjustments`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(listAdjustments.execute).toHaveBeenCalledWith(
      accountOwnedByAnotherActor,
      authenticatedActorId,
    );
  });

  it('does not allow creating an adjustment for another actor account', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'POST',
      payload: {
        justification: 'Reconciliation declared outside the application.',
        occurredAt: '2026-09-24T12:00:00.000Z',
        reportedBalance: '10.00',
      },
      url: `/api/v1/accounts/${accountOwnedByAnotherActor}/balance-adjustments`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(createAdjustment.execute).toHaveBeenCalledWith({
      accountId: accountOwnedByAnotherActor,
      actorId: authenticatedActorId,
      justification: 'Reconciliation declared outside the application.',
      occurredAt: new Date('2026-09-24T12:00:00.000Z'),
      reportedBalance: '10.00',
    });
  });
});
