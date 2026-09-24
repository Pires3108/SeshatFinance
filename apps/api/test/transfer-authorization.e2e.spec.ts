import {
  ChangeOwnedTransferLifecycleUseCase,
  GetOwnedTransferUseCase,
  OwnedTransferNotFoundError,
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

const transferOwnedByAnotherActor = '86684068-45d9-4e14-b454-f7e556b867e7';
const authenticatedActorId = 'actor-b';

describe('Transfer HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const getTransfer = {
    execute: vi
      .fn<GetOwnedTransferUseCase['execute']>()
      .mockResolvedValue(null),
  };
  const changeLifecycle = {
    execute: vi
      .fn<ChangeOwnedTransferLifecycleUseCase['execute']>()
      .mockRejectedValue(new OwnedTransferNotFoundError()),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    getTransfer.execute.mockClear();
    changeLifecycle.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(GetOwnedTransferUseCase)
      .useValue(getTransfer)
      .overrideProvider(ChangeOwnedTransferLifecycleUseCase)
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

  it('does not reveal another actor transfer', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/transfers/${transferOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(getTransfer.execute).toHaveBeenCalledWith(
      transferOwnedByAnotherActor,
      authenticatedActorId,
    );
  });

  it('does not allow changing another actor transfer lifecycle', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: { action: 'archive' },
      url: `/api/v1/transfers/${transferOwnedByAnotherActor}/lifecycle`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(changeLifecycle.execute).toHaveBeenCalledWith({
      action: 'archive',
      actorId: authenticatedActorId,
      transferId: transferOwnedByAnotherActor,
    });
  });
});
