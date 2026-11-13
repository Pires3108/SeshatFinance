import {
  EliminateOwnedTrashItemUseCase,
  ResolveAuthenticatedActorUseCase,
  TrashEliminationBlockedError,
  TrashEliminationConfirmationError,
} from '@seshat/application';
import { TransactionLifecycleError } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const actorId = '0b6f1a52-9d0e-4c8e-9a51-6f3d2c1b0a99';
const transactionId = '3f0e8c1a-6b2d-4e9f-8a7c-5d4b3a2f1e0d';
const transferId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('Trash elimination HTTP (US-034, RF-090)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const eliminate = {
    execute: vi.fn<EliminateOwnedTrashItemUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    eliminate.execute.mockReset().mockResolvedValue(undefined);
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(EliminateOwnedTrashItemUseCase)
      .useValue(eliminate)
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

  function post(
    path: string,
    payload: unknown,
  ): ReturnType<NestFastifyApplication['inject']> {
    return application.inject({
      headers: { authorization: 'Bearer token' },
      method: 'POST',
      payload: payload as Record<string, unknown>,
      url: `/api/v1/${path}`,
    });
  }

  it.each([
    ['transaction', `transactions/${transactionId}/elimination`, transactionId],
    ['transfer', `transfers/${transferId}/elimination`, transferId],
  ] as const)(
    'eliminates an owned %s with the typed confirmation',
    async (resourceType, path, id) => {
      const response = await post(path, { confirmation: id });

      expect(response.statusCode).toBe(204);
      expect(eliminate.execute).toHaveBeenCalledWith({
        actorId,
        confirmation: id,
        id,
        resourceType,
      });
    },
  );

  it('requires a confirmation body before calling the use case', async () => {
    const response = await post(
      `transactions/${transactionId}/elimination`,
      {},
    );

    expect(response.statusCode).toBe(400);
    expect(eliminate.execute).not.toHaveBeenCalled();
  });

  it.each([
    [new TrashEliminationConfirmationError(), 400],
    [new TrashEliminationBlockedError(), 409],
    [new TransactionLifecycleError('not in trash'), 409],
  ])('maps %s to %i', async (error, status) => {
    eliminate.execute.mockRejectedValueOnce(error);

    const response = await post(`transactions/${transactionId}/elimination`, {
      confirmation: transactionId,
    });

    expect(response.statusCode).toBe(status);
  });
});
