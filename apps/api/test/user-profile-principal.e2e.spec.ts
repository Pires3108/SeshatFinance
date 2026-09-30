import {
  ResolveAuthenticatedActorUseCase,
  UpdateOwnUserProfileUseCase,
  type UserProfile,
} from '@seshat/application';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const authenticatedActorId = 'actor-b';
const profile: UserProfile = {
  createdAt: new Date('2026-09-25T12:00:00.000Z'),
  displayName: 'Actor B',
  id: authenticatedActorId,
  locale: 'pt-BR',
  presentationCurrency: 'BRL',
  refundPresentation: 'separate-income',
  timeZone: 'America/Sao_Paulo',
  updatedAt: new Date('2026-09-25T12:00:00.000Z'),
  version: 1,
};

describe('User profile HTTP principal binding', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const updateProfile = {
    execute: vi
      .fn<UpdateOwnUserProfileUseCase['execute']>()
      .mockResolvedValue(profile),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    updateProfile.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(UpdateOwnUserProfileUseCase)
      .useValue(updateProfile)
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

  it('binds updates to the bearer actor when the payload contains another actor id', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: {
        actorId: 'actor-a',
        displayName: 'Actor B',
        locale: 'pt-BR',
        presentationCurrency: 'BRL',
        timeZone: 'America/Sao_Paulo',
      },
      url: '/api/v1/users/me/profile',
    });

    expect(response.statusCode).toBe(200);
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(updateProfile.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      displayName: 'Actor B',
      locale: 'pt-BR',
      presentationCurrency: 'BRL',
      timeZone: 'America/Sao_Paulo',
    });
  });

  it('accepts the refund presentation preference for the authenticated actor', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: {
        displayName: 'Actor B',
        locale: 'pt-BR',
        presentationCurrency: 'BRL',
        refundPresentation: 'expense-offset',
        timeZone: 'America/Sao_Paulo',
      },
      url: '/api/v1/users/me/profile',
    });

    expect(response.statusCode).toBe(200);
    expect(updateProfile.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: authenticatedActorId,
        refundPresentation: 'expense-offset',
      }),
    );
  });
});
