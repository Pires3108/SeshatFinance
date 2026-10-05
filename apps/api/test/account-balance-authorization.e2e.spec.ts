import {
  GetOwnedAccountBalanceUseCase,
  OwnedAccountNotFoundError,
  OpaqueSessionService,
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
  const sessions = {
    resolve: vi
      .fn<OpaqueSessionService['resolve']>()
      .mockResolvedValue(authenticatedActorId),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    getBalance.execute.mockClear();
    sessions.resolve.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(GetOwnedAccountBalanceUseCase)
      .useValue(getBalance)
      .overrideProvider(OpaqueSessionService)
      .useValue(sessions)
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

  it('uses the browser session actor to protect another actor account balance', async () => {
    const token = 'a'.repeat(43);
    const response = await application.inject({
      headers: { cookie: `__Host-seshat_session=${token}` },
      method: 'GET',
      url: `/api/v1/accounts/${accountOwnedByAnotherActor}/balance`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(sessions.resolve).toHaveBeenCalledWith(token);
    expect(resolveActor.execute).not.toHaveBeenCalled();
    expect(getBalance.execute).toHaveBeenCalledWith(
      accountOwnedByAnotherActor,
      authenticatedActorId,
    );
  });
});
