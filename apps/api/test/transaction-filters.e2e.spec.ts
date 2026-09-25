import {
  ListOwnedTransactionsBetweenUseCase,
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

const accountId = '7c2c7a54-73fe-49a3-b0ea-19034bf22baf';

describe('Transaction timeline HTTP filters', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: 'actor-b' }),
  };
  const listTransactions = {
    execute: vi
      .fn<ListOwnedTransactionsBetweenUseCase['execute']>()
      .mockResolvedValue([]),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    listTransactions.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(ListOwnedTransactionsBetweenUseCase)
      .useValue(listTransactions)
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

  it('combines filters under the bearer actor and an explicit range', async () => {
    const query = new URLSearchParams({
      accountId,
      from: '2026-09-20T00:00:00.000Z',
      kind: 'expense',
      lifecycle: 'archived',
      occurredAtOrder: 'desc',
      to: '2026-09-21T00:00:00.000Z',
    });
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/transactions?${query.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(resolveActor.execute).toHaveBeenCalledWith('actor-b-token');
    expect(listTransactions.execute).toHaveBeenCalledWith(
      'actor-b',
      new Date('2026-09-20T00:00:00.000Z'),
      new Date('2026-09-21T00:00:00.000Z'),
      'archived',
      { accountId, kind: 'expense', occurredAtOrder: 'desc' },
    );
  });

  it('rejects an invalid order before reading transactions', async () => {
    const query = new URLSearchParams({
      from: '2026-09-20T00:00:00.000Z',
      occurredAtOrder: 'random',
      to: '2026-09-21T00:00:00.000Z',
    });
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/transactions?${query.toString()}`,
    });

    expect(response.statusCode).toBe(400);
    expect(listTransactions.execute).not.toHaveBeenCalled();
  });
});
