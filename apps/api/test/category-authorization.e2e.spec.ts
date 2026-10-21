import {
  CategoryLinkedError,
  DeleteOwnedCategoryUseCase,
  GetOwnedCategoryUseCase,
  OwnedCategoryNotFoundError,
  RenameOwnedCategoryUseCase,
  ResolveAuthenticatedActorUseCase,
  SetOwnedCategoryArchivedUseCase,
} from '@seshat/application';
import { Category } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const categoryOwnedByAnotherActor = '8b2872c6-cde5-4751-978a-a6257ec6abbd';
const authenticatedActorId = 'actor-b';

describe('Category HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const renameCategory = {
    execute: vi
      .fn<RenameOwnedCategoryUseCase['execute']>()
      .mockRejectedValue(new OwnedCategoryNotFoundError()),
  };
  const archivedCategory = Category.create({
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    id: categoryOwnedByAnotherActor,
    name: 'Histórica',
    ownerId: authenticatedActorId,
    parentCategoryId: null,
  });
  const getCategory = {
    execute: vi
      .fn<GetOwnedCategoryUseCase['execute']>()
      .mockResolvedValue(archivedCategory),
  };
  const setArchived = {
    execute: vi
      .fn<SetOwnedCategoryArchivedUseCase['execute']>()
      .mockResolvedValue(archivedCategory),
  };
  const deleteCategory = {
    execute: vi
      .fn<DeleteOwnedCategoryUseCase['execute']>()
      .mockResolvedValue(undefined),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    renameCategory.execute.mockClear();
    getCategory.execute.mockClear();
    setArchived.execute.mockClear();
    deleteCategory.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(RenameOwnedCategoryUseCase)
      .useValue(renameCategory)
      .overrideProvider(GetOwnedCategoryUseCase)
      .useValue(getCategory)
      .overrideProvider(SetOwnedCategoryArchivedUseCase)
      .useValue(setArchived)
      .overrideProvider(DeleteOwnedCategoryUseCase)
      .useValue(deleteCategory)
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

  it('does not allow renaming another actor category', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: { name: 'Private category' },
      url: `/api/v1/categories/${categoryOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(renameCategory.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      categoryId: categoryOwnedByAnotherActor,
      name: 'Private category',
    });
  });

  it('returns an archived category for historical reads', async () => {
    archivedCategory.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/categories/${categoryOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: categoryOwnedByAnotherActor,
      archivedAt: '2026-09-20T13:00:00.000Z',
    });
    expect(getCategory.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      categoryId: categoryOwnedByAnotherActor,
    });
  });

  it.each([
    { method: 'PATCH', suffix: 'archive', archived: true },
    { method: 'PATCH', suffix: 'restore', archived: false },
  ] as const)(
    '$suffix applies lifecycle changes for the authenticated actor',
    async ({ method, suffix, archived }) => {
      const response = await application.inject({
        headers: { authorization: 'Bearer actor-b-token' },
        method,
        url: `/api/v1/categories/${categoryOwnedByAnotherActor}/${suffix}`,
      });
      expect(response.statusCode).toBe(200);
      expect(setArchived.execute).toHaveBeenCalledWith({
        actorId: authenticatedActorId,
        categoryId: categoryOwnedByAnotherActor,
        archived,
      });
    },
  );

  it('rejects deletion of a historically linked category', async () => {
    deleteCategory.execute.mockRejectedValueOnce(new CategoryLinkedError());
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'DELETE',
      url: `/api/v1/categories/${categoryOwnedByAnotherActor}`,
    });
    expect(response.statusCode).toBe(409);
    expect(deleteCategory.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      categoryId: categoryOwnedByAnotherActor,
    });
  });

  it('deletes an unlinked owned category', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'DELETE',
      url: `/api/v1/categories/${categoryOwnedByAnotherActor}`,
    });
    expect(response.statusCode).toBe(200);
    expect(deleteCategory.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      categoryId: categoryOwnedByAnotherActor,
    });
  });

  it('does not expose another actor category through read or lifecycle endpoints', async () => {
    getCategory.execute.mockRejectedValueOnce(new OwnedCategoryNotFoundError());
    setArchived.execute.mockRejectedValueOnce(new OwnedCategoryNotFoundError());
    deleteCategory.execute.mockRejectedValueOnce(
      new OwnedCategoryNotFoundError(),
    );
    for (const [method, suffix] of [
      ['GET', ''],
      ['PATCH', '/archive'],
      ['DELETE', ''],
    ] as const) {
      const response = await application.inject({
        headers: { authorization: 'Bearer actor-b-token' },
        method,
        url: `/api/v1/categories/${categoryOwnedByAnotherActor}${suffix}`,
      });
      expect(response.statusCode).toBe(404);
    }
  });
});
