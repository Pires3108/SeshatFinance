import {
  GetOwnedTransactionClassificationUseCase,
  InvalidOwnedTransactionClassificationError,
  OwnedTransactionNotFoundError,
  ResolveAuthenticatedActorUseCase,
  SetOwnedTransactionClassificationUseCase,
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
const classificationOwnedByAnotherActor =
  '2e1fe3e4-cf56-460d-bb9f-b21c318ff93e';
const authenticatedActorId = 'actor-b';
const emptySelection = {
  categoryId: null,
  costCenterId: null,
  subcategoryId: null,
};

describe('Transaction classification HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const getClassification = {
    execute: vi
      .fn<GetOwnedTransactionClassificationUseCase['execute']>()
      .mockRejectedValue(new OwnedTransactionNotFoundError()),
  };
  const setClassification = {
    execute: vi
      .fn<SetOwnedTransactionClassificationUseCase['execute']>()
      .mockRejectedValue(new OwnedTransactionNotFoundError()),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    getClassification.execute.mockClear();
    setClassification.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(GetOwnedTransactionClassificationUseCase)
      .useValue(getClassification)
      .overrideProvider(SetOwnedTransactionClassificationUseCase)
      .useValue(setClassification)
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

  it('does not reveal another actor transaction classification', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}/classification`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(getClassification.execute).toHaveBeenCalledWith(
      transactionOwnedByAnotherActor,
      authenticatedActorId,
    );
  });

  it('does not allow replacing another actor transaction classification', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PUT',
      payload: emptySelection,
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}/classification`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(setClassification.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      ...emptySelection,
      transactionId: transactionOwnedByAnotherActor,
    });
  });

  it('rejects a classification owned by another actor', async () => {
    setClassification.execute.mockRejectedValueOnce(
      new InvalidOwnedTransactionClassificationError(),
    );
    const selection = {
      categoryId: classificationOwnedByAnotherActor,
      costCenterId: null,
      subcategoryId: null,
    };

    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PUT',
      payload: selection,
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}/classification`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
    expect(setClassification.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      ...selection,
      transactionId: transactionOwnedByAnotherActor,
    });
  });
});
