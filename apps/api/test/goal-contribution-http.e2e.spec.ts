import {
  ContributionSourceNotFoundError,
  ContributionVersionConflictError,
  DistributeContributionUseCase,
  GetContributionUseCase,
  ListContributionSourcesUseCase,
  ResolveAuthenticatedActorUseCase,
  type ContributionView,
} from '@seshat/application';
import {
  ContributionExceedsSourceError,
  Currency,
  Money,
} from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const actorId = 'actor-c';
const sourceId = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const goalA = '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e';
const goalB = '3d4e5f60-7182-4c9d-8e1f-2a3b4c5d6e7f';
const accountId = '4e5f6071-8293-4dae-9f20-3b4c5d6e7f80';
const key = '5f607182-93a4-4ebf-8031-4c5d6e7f8091';
const brl = Currency.create('BRL', 2);
const money = (amount: string): Money => Money.fromDecimal(amount, brl);
const auth = { authorization: 'Bearer actor-c-token' };
const source = {
  accountId,
  amount: money('100.00'),
  description: 'Salário',
  id: sourceId,
  kind: 'income' as const,
  lifecycle: 'active' as const,
  occurredAt: new Date('2026-11-20T12:00:00Z'),
};

function view(): ContributionView {
  return {
    allocated: money('100.00'),
    lines: [
      { amount: money('60.00'), goalId: goalA },
      { amount: money('40.00'), goalId: goalB },
    ],
    remaining: money('0.00'),
    source,
    version: 1,
  };
}

describe('Goal contribution HTTP contract (US-050)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const distribute = {
    execute: vi.fn<DistributeContributionUseCase['execute']>(),
  };
  const get = { execute: vi.fn<GetContributionUseCase['execute']>() };
  const sources = {
    execute: vi.fn<ListContributionSourcesUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    distribute.execute.mockReset().mockResolvedValue(view());
    get.execute.mockReset().mockResolvedValue(view());
    sources.execute
      .mockReset()
      .mockResolvedValue([{ ...source, allocated: null, version: 0 }]);
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(DistributeContributionUseCase)
      .useValue(distribute)
      .overrideProvider(GetContributionUseCase)
      .useValue(get)
      .overrideProvider(ListContributionSourcesUseCase)
      .useValue(sources)
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
      url: '/api/v1/goal-contributions/sources',
    });
    expect(response.statusCode).toBe(401);
  });

  it('distributes an entry between two goals', async () => {
    const lines = [
      { amount: '60.00', goalId: goalA },
      { amount: '40.00', goalId: goalB },
    ];
    const response = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'PUT',
      payload: { expectedVersion: 0, lines },
      url: `/api/v1/goal-contributions/${sourceId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(distribute.execute).toHaveBeenCalledWith({
      actorId,
      expectedVersion: 0,
      idempotencyKey: key,
      lines,
      sourceTransactionId: sourceId,
    });
    expect(response.json()).toMatchObject({
      allocated: { amount: '100.00', currencyCode: 'BRL' },
      remaining: { amount: '0.00' },
      source: { amount: { amount: '100.00' }, kind: 'income' },
      version: 1,
    });
  });

  it('lists eligible sources and reads one distribution', async () => {
    const list = await application.inject({
      headers: auth,
      method: 'GET',
      url: '/api/v1/goal-contributions/sources',
    });
    const one = await application.inject({
      headers: auth,
      method: 'GET',
      url: `/api/v1/goal-contributions/${sourceId}`,
    });

    expect(list.json()).toMatchObject([{ allocated: null, id: sourceId }]);
    expect(one.statusCode).toBe(200);
  });

  it('rejects a missing key and invalid lines before the use case', async () => {
    const noKey = await application.inject({
      headers: auth,
      method: 'PUT',
      payload: { expectedVersion: 0, lines: [] },
      url: `/api/v1/goal-contributions/${sourceId}`,
    });
    const invalid = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'PUT',
      payload: { expectedVersion: 0, lines: [{ amount: '-1', goalId: goalA }] },
      url: `/api/v1/goal-contributions/${sourceId}`,
    });

    expect(noKey.statusCode).toBe(400);
    expect(invalid.statusCode).toBe(400);
    expect(distribute.execute).not.toHaveBeenCalled();
  });

  it('maps excess, version and ownership errors', async () => {
    distribute.execute
      .mockRejectedValueOnce(new ContributionExceedsSourceError())
      .mockRejectedValueOnce(new ContributionVersionConflictError())
      .mockRejectedValueOnce(new ContributionSourceNotFoundError());
    const put = (): ReturnType<NestFastifyApplication['inject']> =>
      application.inject({
        headers: { ...auth, 'idempotency-key': key },
        method: 'PUT',
        payload: { expectedVersion: 0, lines: [] },
        url: `/api/v1/goal-contributions/${sourceId}`,
      });

    expect((await put()).statusCode).toBe(422);
    expect((await put()).statusCode).toBe(409);
    expect((await put()).statusCode).toBe(404);
  });
});
