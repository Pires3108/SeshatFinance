import {
  ListOwnFamilyGroupsUseCase,
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

const authenticatedActorId = 'actor-b';

describe('Family group HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const listFamilyGroups = {
    execute: vi.fn<ListOwnFamilyGroupsUseCase['execute']>().mockResolvedValue([
      {
        groupId: '70299a8b-16ba-4b45-a50e-2ef035d42f7a',
        joinedAt: new Date('2026-09-25T12:00:00.000Z'),
        role: 'owner',
        userId: authenticatedActorId,
      },
    ]),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    listFamilyGroups.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(ListOwnFamilyGroupsUseCase)
      .useValue(listFamilyGroups)
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

  it('lists groups only for the actor resolved from the bearer token', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: '/api/v1/family-groups?actorId=actor-a',
    });

    expect(response.statusCode).toBe(200);
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(listFamilyGroups.execute).toHaveBeenCalledWith(authenticatedActorId);
  });
});
