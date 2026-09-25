import {
  OwnedCostCenterNotFoundError,
  RenameOwnedCostCenterUseCase,
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

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    renameCostCenter.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(RenameOwnedCostCenterUseCase)
      .useValue(renameCostCenter)
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
});
