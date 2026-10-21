import {
  CostCenterLinkedError,
  DeleteOwnedCostCenterUseCase,
  GetOwnedCostCenterUseCase,
  OwnedCostCenterNotFoundError,
  RenameOwnedCostCenterUseCase,
  ResolveAuthenticatedActorUseCase,
  SetOwnedCostCenterArchivedUseCase,
} from '@seshat/application';
import { CostCenter } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const costCenterOwnedByAnotherActor = 'a61a06c5-a9bc-4e3f-ac92-707b7d7568b7';
const authenticatedActorId = 'actor-b';

describe('Cost center HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: authenticatedActorId }),
  };
  const renameCostCenter = {
    execute: vi
      .fn<RenameOwnedCostCenterUseCase['execute']>()
      .mockRejectedValue(new OwnedCostCenterNotFoundError()),
  };
  const historicalCenter = CostCenter.create({
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    id: costCenterOwnedByAnotherActor,
    name: 'Histórico',
    ownerId: authenticatedActorId,
  });
  const getCenter = {
    execute: vi
      .fn<GetOwnedCostCenterUseCase['execute']>()
      .mockResolvedValue(historicalCenter),
  };
  const setArchived = {
    execute: vi
      .fn<SetOwnedCostCenterArchivedUseCase['execute']>()
      .mockResolvedValue(historicalCenter),
  };
  const deleteCenter = {
    execute: vi
      .fn<DeleteOwnedCostCenterUseCase['execute']>()
      .mockResolvedValue(undefined),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    renameCostCenter.execute.mockClear();
    getCenter.execute.mockClear();
    setArchived.execute.mockClear();
    deleteCenter.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(RenameOwnedCostCenterUseCase)
      .useValue(renameCostCenter)
      .overrideProvider(GetOwnedCostCenterUseCase)
      .useValue(getCenter)
      .overrideProvider(SetOwnedCostCenterArchivedUseCase)
      .useValue(setArchived)
      .overrideProvider(DeleteOwnedCostCenterUseCase)
      .useValue(deleteCenter)
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

  it('does not allow renaming another actor cost center', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'PATCH',
      payload: { name: 'Private cost center' },
      url: `/api/v1/cost-centers/${costCenterOwnedByAnotherActor}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(renameCostCenter.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      costCenterId: costCenterOwnedByAnotherActor,
      name: 'Private cost center',
    });
  });

  it('reads an archived center for historical consultation', async () => {
    historicalCenter.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/cost-centers/${costCenterOwnedByAnotherActor}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: costCenterOwnedByAnotherActor,
      archivedAt: '2026-09-20T13:00:00.000Z',
    });
    expect(getCenter.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      costCenterId: costCenterOwnedByAnotherActor,
    });
  });

  it.each([
    { suffix: 'archive', archived: true },
    { suffix: 'restore', archived: false },
  ] as const)(
    '$suffix uses the authenticated actor',
    async ({ suffix, archived }) => {
      const response = await application.inject({
        headers: { authorization: 'Bearer actor-b-token' },
        method: 'PATCH',
        url: `/api/v1/cost-centers/${costCenterOwnedByAnotherActor}/${suffix}`,
      });
      expect(response.statusCode).toBe(200);
      expect(setArchived.execute).toHaveBeenCalledWith({
        actorId: authenticatedActorId,
        costCenterId: costCenterOwnedByAnotherActor,
        archived,
      });
    },
  );

  it('rejects deletion of a historically linked center', async () => {
    deleteCenter.execute.mockRejectedValueOnce(new CostCenterLinkedError());
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'DELETE',
      url: `/api/v1/cost-centers/${costCenterOwnedByAnotherActor}`,
    });
    expect(response.statusCode).toBe(409);
    expect(deleteCenter.execute).toHaveBeenCalledWith({
      actorId: authenticatedActorId,
      costCenterId: costCenterOwnedByAnotherActor,
    });
  });

  it('hides another owner center on read, archive, and delete', async () => {
    getCenter.execute.mockRejectedValueOnce(new OwnedCostCenterNotFoundError());
    setArchived.execute.mockRejectedValueOnce(
      new OwnedCostCenterNotFoundError(),
    );
    deleteCenter.execute.mockRejectedValueOnce(
      new OwnedCostCenterNotFoundError(),
    );
    for (const [method, suffix] of [
      ['GET', ''],
      ['PATCH', '/archive'],
      ['DELETE', ''],
    ] as const) {
      const response = await application.inject({
        headers: { authorization: 'Bearer actor-b-token' },
        method,
        url: `/api/v1/cost-centers/${costCenterOwnedByAnotherActor}${suffix}`,
      });
      expect(response.statusCode).toBe(404);
    }
  });
});
