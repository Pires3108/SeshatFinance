import {
  ListOwnedFinancialAuditTrailUseCase,
  ResolveAuthenticatedActorUseCase,
  VerifyOwnedFinancialAuditChainUseCase,
} from '@seshat/application';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const actorB = '0b6f1a52-9d0e-4c8e-9a51-6f3d2c1b0a99';
const resourceId = '3f0e8c1a-6b2d-4e9f-8a7c-5d4b3a2f1e0d';

describe('Financial audit trail HTTP (US-035)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorB }),
  };
  const listTrail = {
    execute: vi.fn<ListOwnedFinancialAuditTrailUseCase['execute']>(),
  };
  const verifyChain = {
    execute: vi.fn<VerifyOwnedFinancialAuditChainUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    listTrail.execute.mockReset().mockResolvedValue([
      {
        action: 'moved-to-trash',
        actorId: actorB,
        correlationId: null,
        errorCode: null,
        hash: 'b'.repeat(64),
        id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        occurredAt: new Date('2026-11-12T10:00:00.000Z'),
        previousHash: 'a'.repeat(64),
        resourceId,
        resourceType: 'transaction',
        result: 'succeeded',
        sequence: 12n,
      },
    ]);
    verifyChain.execute
      .mockReset()
      .mockResolvedValue({ checkedEvents: 12n, firstInvalidSequence: 5n });
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(ListOwnedFinancialAuditTrailUseCase)
      .useValue(listTrail)
      .overrideProvider(VerifyOwnedFinancialAuditChainUseCase)
      .useValue(verifyChain)
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

  it('lists only the authenticated actor trail with allowlisted fields', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer token' },
      method: 'GET',
      url: `/api/v1/audit-events?afterSequence=11&limit=5&resourceType=transaction&resourceId=${resourceId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(listTrail.execute).toHaveBeenCalledWith(actorB, {
      afterSequence: 11n,
      limit: 5,
      resourceId,
      resourceType: 'transaction',
    });
    const [entry] = response.json<Record<string, unknown>[]>();
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'action',
      'actorId',
      'correlationId',
      'errorCode',
      'hash',
      'id',
      'occurredAt',
      'previousHash',
      'resourceId',
      'resourceType',
      'result',
      'sequence',
    ]);
    expect(entry).toMatchObject({ sequence: '12', action: 'moved-to-trash' });
  });

  it.each([
    'ownerId=1b6f1a52-9d0e-4c8e-9a51-6f3d2c1b0a99',
    'limit=0',
    'afterSequence=-1',
    'resourceType=refund',
  ])('rejects the query %s without reading the trail', async (query) => {
    const response = await application.inject({
      headers: { authorization: 'Bearer token' },
      method: 'GET',
      url: `/api/v1/audit-events?${query}`,
    });

    expect(response.statusCode).toBe(400);
    expect(listTrail.execute).not.toHaveBeenCalled();
  });

  it('reports the first tampered sequence of the actor chain', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer token' },
      method: 'GET',
      url: '/api/v1/audit-events/verification',
    });

    expect(response.statusCode).toBe(200);
    expect(verifyChain.execute).toHaveBeenCalledWith(actorB);
    expect(response.json()).toEqual({
      checkedEvents: '12',
      firstInvalidSequence: '5',
      valid: false,
    });
  });

  it('requires authentication', async () => {
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/audit-events/verification',
    });

    expect(response.statusCode).toBe(401);
    expect(verifyChain.execute).not.toHaveBeenCalled();
  });
});
