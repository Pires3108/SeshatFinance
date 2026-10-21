import {
  DeleteOwnedTagUseCase,
  GetOwnedTagUseCase,
  OwnedTagNotFoundError,
  RenameOwnedTagUseCase,
  ResolveAuthenticatedActorUseCase,
  SetOwnedTagArchivedUseCase,
  TagLinkedError,
} from '@seshat/application';
import { Tag } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const tagOwnedByAnotherActor = '0e881434-f1a2-4896-82c7-72c8f29ed792';
const authenticatedActorId = 'actor-b';

describe('Tag HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const renameTag = {
    execute: vi
      .fn<RenameOwnedTagUseCase['execute']>()
      .mockRejectedValue(new OwnedTagNotFoundError()),
  };
  const historicalTag = Tag.create({
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    id: tagOwnedByAnotherActor,
    name: 'Histórica',
    ownerId: authenticatedActorId,
  });
  const getTag = {
    execute: vi
      .fn<GetOwnedTagUseCase['execute']>()
      .mockResolvedValue(historicalTag),
  };
  const setArchived = {
    execute: vi
      .fn<SetOwnedTagArchivedUseCase['execute']>()
      .mockResolvedValue(historicalTag),
  };
  const deleteTag = {
    execute: vi
      .fn<DeleteOwnedTagUseCase['execute']>()
      .mockResolvedValue(undefined),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    renameTag.execute.mockClear();
    getTag.execute.mockClear();
    setArchived.execute.mockClear();
    deleteTag.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(RenameOwnedTagUseCase)
      .useValue(renameTag)
      .overrideProvider(GetOwnedTagUseCase)
      .useValue(getTag)
      .overrideProvider(SetOwnedTagArchivedUseCase)
      .useValue(setArchived)
      .overrideProvider(DeleteOwnedTagUseCase)
      .useValue(deleteTag)
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

  it('does not allow renaming another actor tag', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: { name: 'Private tag' },
      url: `/api/v1/tags/${tagOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(renameTag.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      name: 'Private tag',
      tagId: tagOwnedByAnotherActor,
    });
  });

  it('keeps an archived tag available for historical reads', async () => {
    historicalTag.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/tags/${tagOwnedByAnotherActor}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: tagOwnedByAnotherActor,
      archivedAt: '2026-09-20T13:00:00.000Z',
    });
    expect(getTag.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      tagId: tagOwnedByAnotherActor,
    });
  });

  it.each([
    { suffix: 'archive', archived: true },
    { suffix: 'restore', archived: false },
  ] as const)(
    '$suffix uses the authenticated owner',
    async ({ suffix, archived }) => {
      const response = await application.inject({
        headers: { authorization: 'Bearer actor-b-token' },
        method: 'PATCH',
        url: `/api/v1/tags/${tagOwnedByAnotherActor}/${suffix}`,
      });
      expect(response.statusCode).toBe(200);
      expect(setArchived.execute).toHaveBeenCalledWith({
        actorId: authenticatedActorId,
        tagId: tagOwnedByAnotherActor,
        archived,
      });
    },
  );

  it('rejects deletion of a linked tag', async () => {
    deleteTag.execute.mockRejectedValueOnce(new TagLinkedError());
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'DELETE',
      url: `/api/v1/tags/${tagOwnedByAnotherActor}`,
    });
    expect(response.statusCode).toBe(409);
    expect(deleteTag.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      tagId: tagOwnedByAnotherActor,
    });
  });

  it('hides another actor tag on GET, archive, and DELETE', async () => {
    getTag.execute.mockRejectedValueOnce(new OwnedTagNotFoundError());
    setArchived.execute.mockRejectedValueOnce(new OwnedTagNotFoundError());
    deleteTag.execute.mockRejectedValueOnce(new OwnedTagNotFoundError());
    for (const [method, suffix] of [
      ['GET', ''],
      ['PATCH', '/archive'],
      ['DELETE', ''],
    ] as const) {
      const response = await application.inject({
        headers: { authorization: 'Bearer actor-b-token' },
        method,
        url: `/api/v1/tags/${tagOwnedByAnotherActor}${suffix}`,
      });
      expect(response.statusCode).toBe(404);
    }
  });
});
