import {
  InvalidOwnedTagSelectionError,
  ListOwnedTransactionTagsUseCase,
  OwnedTransactionNotFoundError,
  ResolveAuthenticatedActorUseCase,
  SetOwnedTransactionTagsUseCase,
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
const tagOwnedByAnotherActor = '2e1fe3e4-cf56-460d-bb9f-b21c318ff93e';
const authenticatedActorId = 'actor-b';

describe('Transaction tag HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const listTags = {
    execute: vi
      .fn<ListOwnedTransactionTagsUseCase['execute']>()
      .mockRejectedValue(new OwnedTransactionNotFoundError()),
  };
  const replaceTags = {
    execute: vi
      .fn<SetOwnedTransactionTagsUseCase['execute']>()
      .mockRejectedValue(new OwnedTransactionNotFoundError()),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    listTags.execute.mockClear();
    replaceTags.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(ListOwnedTransactionTagsUseCase)
      .useValue(listTags)
      .overrideProvider(SetOwnedTransactionTagsUseCase)
      .useValue(replaceTags)
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

  it('does not reveal another actor transaction through its tag list', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}/tags`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(listTags.execute).toHaveBeenCalledWith(
      transactionOwnedByAnotherActor,
      authenticatedActorId,
    );
  });

  it('does not allow an actor to replace tags on another actor transaction', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PUT',
      payload: { tagIds: [tagOwnedByAnotherActor] },
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}/tags`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(replaceTags.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      tagIds: [tagOwnedByAnotherActor],
      transactionId: transactionOwnedByAnotherActor,
    });
  });

  it('rejects assigning a tag owned by another actor', async () => {
    replaceTags.execute.mockRejectedValueOnce(
      new InvalidOwnedTagSelectionError(),
    );

    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PUT',
      payload: { tagIds: [tagOwnedByAnotherActor] },
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}/tags`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
    expect(replaceTags.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      tagIds: [tagOwnedByAnotherActor],
      transactionId: transactionOwnedByAnotherActor,
    });
  });

  it('passes multiple selected tags through the authenticated write boundary', async () => {
    const first = '0863dc92-54f3-4bfc-96c5-a8bac9190181';
    const second = 'b3ea562a-2e77-4337-9402-027511b133e7';
    replaceTags.execute.mockResolvedValueOnce([first, second]);

    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PUT',
      payload: { tagIds: [first, second, first] },
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}/tags`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tagIds: [first, second] });
    expect(replaceTags.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      tagIds: [first, second, first],
      transactionId: transactionOwnedByAnotherActor,
    });
  });

  it('allows removing all tag assignments', async () => {
    replaceTags.execute.mockResolvedValueOnce([]);
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PUT',
      payload: { tagIds: [] },
      url: `/api/v1/transactions/${transactionOwnedByAnotherActor}/tags`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tagIds: [] });
  });
});
