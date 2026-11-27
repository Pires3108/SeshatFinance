import {
  ChangeInvestmentLifecycleUseCase,
  CreateInvestmentUseCase,
  GetInvestmentUseCase,
  InvestmentNotFoundError,
  InvestmentVersionConflictError,
  ListInvestmentsUseCase,
  ResolveAuthenticatedActorUseCase,
  UpdateInvestmentUseCase,
} from '@seshat/application';
import {
  CivilDate,
  Currency,
  Investment,
  InvestmentLifecycleError,
  InvestmentType,
} from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const actorId = 'actor-i1';
const investmentId = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const key = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const auth = { authorization: 'Bearer actor-i1-token' };

function investment(): Investment {
  return Investment.create({
    code: 'PETR4',
    contractedRate: null,
    createdAt: new Date('2026-11-27T12:00:00Z'),
    currency: Currency.create('BRL', 2),
    id: investmentId,
    institution: 'Corretora Exemplo',
    liquidity: { days: 2, kind: 'd-plus' },
    maturityDate: null,
    name: 'Petrobras PN',
    ownerId: actorId,
    startDate: CivilDate.parse('2026-03-02'),
    type: InvestmentType.create('stock'),
  });
}

const body = {
  code: 'PETR4',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  institution: 'Corretora Exemplo',
  liquidity: { days: 2, kind: 'd-plus' },
  name: 'Petrobras PN',
  startDate: '2026-03-02',
  type: 'stock',
};

describe('Investment HTTP contract (US-054)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const create = { execute: vi.fn<CreateInvestmentUseCase['execute']>() };
  const list = { execute: vi.fn<ListInvestmentsUseCase['execute']>() };
  const get = { execute: vi.fn<GetInvestmentUseCase['execute']>() };
  const update = { execute: vi.fn<UpdateInvestmentUseCase['execute']>() };
  const lifecycle = {
    execute: vi.fn<ChangeInvestmentLifecycleUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    for (const mock of [create, get, update, lifecycle]) {
      mock.execute.mockReset().mockResolvedValue(investment());
    }
    list.execute.mockReset().mockResolvedValue([investment()]);
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(CreateInvestmentUseCase)
      .useValue(create)
      .overrideProvider(ListInvestmentsUseCase)
      .useValue(list)
      .overrideProvider(GetInvestmentUseCase)
      .useValue(get)
      .overrideProvider(UpdateInvestmentUseCase)
      .useValue(update)
      .overrideProvider(ChangeInvestmentLifecycleUseCase)
      .useValue(lifecycle)
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

  it('requires authentication', async () => {
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/investments',
    });
    expect(response.statusCode).toBe(401);
  });

  it('registers an investment for the authenticated holder', async () => {
    const response = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: body,
      url: '/api/v1/investments',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      code: 'PETR4',
      contractedRate: null,
      id: investmentId,
      lifecycle: 'active',
      liquidity: { days: 2, kind: 'd-plus' },
      quantityScale: 0,
      type: 'stock',
      version: 1,
    });
    expect(create.execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, idempotencyKey: key, type: 'stock' }),
    );
  });

  it('requires an idempotency key to register', async () => {
    const response = await application.inject({
      headers: auth,
      method: 'POST',
      payload: body,
      url: '/api/v1/investments',
    });
    expect(response.statusCode).toBe(400);
    expect(create.execute).not.toHaveBeenCalled();
  });

  it('rejects numbers where decimal strings are expected', async () => {
    const response = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: {
        ...body,
        contractedRate: { indexer: 'cdi', percent: 110 },
      },
      url: '/api/v1/investments',
    });
    expect(response.statusCode).toBe(400);
    expect(create.execute).not.toHaveBeenCalled();
  });

  it('rejects an unknown type before reaching the use case', async () => {
    const response = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: { ...body, type: 'option' },
      url: '/api/v1/investments',
    });
    expect(response.statusCode).toBe(400);
  });

  it('lists and reads owned investments', async () => {
    const listed = await application.inject({
      headers: auth,
      method: 'GET',
      url: '/api/v1/investments',
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(list.execute).toHaveBeenCalledWith(actorId);

    get.execute.mockRejectedValueOnce(new InvestmentNotFoundError());
    const missing = await application.inject({
      headers: auth,
      method: 'GET',
      url: `/api/v1/investments/${investmentId}`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('maps version conflicts and lifecycle errors', async () => {
    update.execute.mockRejectedValueOnce(new InvestmentVersionConflictError());
    const conflict = await application.inject({
      headers: auth,
      method: 'PUT',
      payload: { ...body, expectedVersion: 1 },
      url: `/api/v1/investments/${investmentId}`,
    });
    expect(conflict.statusCode).toBe(409);

    lifecycle.execute.mockRejectedValueOnce(
      new InvestmentLifecycleError(
        'Only a trashed investment can become active.',
      ),
    );
    const invalid = await application.inject({
      headers: auth,
      method: 'POST',
      payload: { action: 'restore', expectedVersion: 1 },
      url: `/api/v1/investments/${investmentId}/lifecycle`,
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('archives an investment with the expected version', async () => {
    const response = await application.inject({
      headers: auth,
      method: 'POST',
      payload: { action: 'archive', expectedVersion: 1 },
      url: `/api/v1/investments/${investmentId}/lifecycle`,
    });
    expect(response.statusCode).toBe(200);
    expect(lifecycle.execute).toHaveBeenCalledWith({
      action: 'archive',
      actorId,
      expectedVersion: 1,
      investmentId,
    });
  });
});
