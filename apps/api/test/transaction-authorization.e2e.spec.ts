import {
  ChangeOwnedTransactionLifecycleUseCase,
  GetOwnedTransactionUseCase,
  OwnedTransactionNotFoundError,
  ResolveAuthenticatedActorUseCase,
  UpdateOwnedTransactionUseCase,
} from '@seshat/application';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const transactionOwnedByAnotherActor = '86684068-45d9-4e14-b454-f7e556b867e7';
const authenticatedActorId = 'actor-b';
const update = {
  amount: '10.00',
  description: null,
  kind: 'expense' as const,
  observations: null,
  occurredAt: '2026-09-24T12:00:00.000Z',
};

describe('Transaction HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const getTransaction = {
    execute: vi
      .fn<GetOwnedTransactionUseCase['execute']>()
      .mockResolvedValue(null),
  };
  const updateTransaction = {
    execute: vi
      .fn<UpdateOwnedTransactionUseCase['execute']>()
      .mockRejectedValue(new OwnedTransactionNotFoundError()),
  };
  const changeLifecycle = {
    execute: vi
      .fn<ChangeOwnedTransactionLifecycleUseCase['execute']>()
      .mockRejectedValue(new OwnedTransactionNotFoundError()),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    getTransaction.execute.mockClear();
    updateTransaction.execute.mockClear();
    changeLifecycle.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(GetOwnedTransactionUseCase)
      .useValue(getTransaction)
      .overrideProvider(UpdateOwnedTransactionUseCase)
      .useValue(updateTransaction)
      .overrideProvider(ChangeOwnedTransactionLifecycleUseCase)
      .useValue(changeLifecycle)
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

  it('does not reveal another actor transaction', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(getTransaction.execute).toHaveBeenCalledWith(
      transactionOwnedByAnotherActor,
      authenticatedActorId,
    );
  });

  it('does not allow updating another actor transaction', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: update,
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(updateTransaction.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      ...update,
      occurredAt: new Date(update.occurredAt),
      transactionId: transactionOwnedByAnotherActor,
    });
  });

  it('does not allow changing another actor transaction lifecycle', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: { action: 'archive' },
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}/lifecycle`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(changeLifecycle.execute).toHaveBeenCalledWith({
      action: 'archive',
      actorId: authenticatedActorId,
      transactionId: transactionOwnedByAnotherActor,
    });
  });
});
