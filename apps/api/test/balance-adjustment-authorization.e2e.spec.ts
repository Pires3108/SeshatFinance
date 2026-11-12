import {
  BalanceAdjustmentAccountUnavailableError,
  CreateBalanceAdjustmentUseCase,
  IdempotencyConflictError,
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
const idempotencyKey = '5b2c8f3e-1a4d-4e6f-9b0c-7d8e9f0a1b2c';

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
      headers: {
        authorization: 'Bearer actor-b-token',
        'idempotency-key': idempotencyKey,
      },
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
      idempotencyKey,
      justification: 'Reconciliation declared outside the application.',
      occurredAt: new Date('2026-09-24T12:00:00.000Z'),
      reportedBalance: '10.00',
    });
  });

  it.each([
    ['missing', undefined],
    ['not a UUID', 'not-a-uuid'],
    ['not version 4', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
  ])(
    'rejects an Idempotency-Key that is %s before calling the use case',
    async (_label, key) => {
      const response = await application.inject({
        headers: {
          authorization: 'Bearer actor-b-token',
          ...(key === undefined ? {} : { 'idempotency-key': key }),
        },
        method: 'POST',
        payload: {
          justification: 'Conferência do extrato',
          occurredAt: '2026-09-24T12:00:00.000Z',
          reportedBalance: '10.00',
        },
        url: `/api/v1/accounts/${accountOwnedByAnotherActor}/balance-adjustments`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: 'INVALID_REQUEST' },
      });
      expect(createAdjustment.execute).not.toHaveBeenCalled();
    },
  );

  it('maps an idempotency conflict to 409', async () => {
    createAdjustment.execute.mockRejectedValueOnce(
      new IdempotencyConflictError(),
    );
    const response = await application.inject({
      headers: {
        authorization: 'Bearer actor-b-token',
        'idempotency-key': idempotencyKey,
      },
      method: 'POST',
      payload: {
        justification: 'Conferência do extrato',
        occurredAt: '2026-09-24T12:00:00.000Z',
        reportedBalance: '10.00',
      },
      url: `/api/v1/accounts/${accountOwnedByAnotherActor}/balance-adjustments`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });
});
