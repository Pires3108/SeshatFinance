import { ListTemporalTransactionsUseCase, ResolveAuthenticatedActorUseCase } from '@seshat/application';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

describe('Temporal transaction HTTP contract', () => {
  let application: NestFastifyApplication;
  const resolveActor = { execute: vi.fn<ResolveAuthenticatedActorUseCase['execute']>().mockResolvedValue({ id: 'owner-b' }) };
  const listTemporal = { execute: vi.fn<ListTemporalTransactionsUseCase['execute']>() };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    listTemporal.execute.mockReset();
    listTemporal.execute.mockResolvedValue({
      period: 'day', selectedDate: '2026-11-02', timeZone: 'America/Sao_Paulo',
      from: new Date('2026-11-02T03:00:00Z'), to: new Date('2026-11-03T03:00:00Z'),
      days: [{ date: '2026-11-02', transactions: [], totals: [] }], totals: [],
    });
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ResolveAuthenticatedActorUseCase).useValue(resolveActor)
      .overrideProvider(ListTemporalTransactionsUseCase).useValue(listTemporal)
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
  });

  afterEach(async (): Promise<void> => { await application.close(); });

  it('routes an authorized selection with canonical period metadata', async () => {
    const response = await application.inject({
      method: 'GET', headers: { authorization: 'Bearer owner-b-token' },
      url: '/api/v1/transactions/temporal?period=day&date=2026-11-02',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      period: 'day', selectedDate: '2026-11-02', timeZone: 'America/Sao_Paulo',
      from: '2026-11-02T03:00:00.000Z', to: '2026-11-03T03:00:00.000Z',
      days: [{ date: '2026-11-02', transactions: [], totals: [] }], totals: [],
    });
    expect(resolveActor.execute).toHaveBeenCalledWith('owner-b-token');
    expect(listTemporal.execute).toHaveBeenCalledWith('owner-b', 'day', '2026-11-02');
  });

  it('requires authentication and rejects invalid civil dates before querying', async () => {
    const unauthenticated = await application.inject({ method: 'GET', url: '/api/v1/transactions/temporal?period=day&date=2026-11-02' });
    expect(unauthenticated.statusCode).toBe(401);
    const invalid = await application.inject({
      method: 'GET', headers: { authorization: 'Bearer owner-b-token' },
      url: '/api/v1/transactions/temporal?period=week&date=2026-02-30',
    });
    expect(invalid.statusCode).toBe(400);
    expect(listTemporal.execute).not.toHaveBeenCalled();
  });
});
