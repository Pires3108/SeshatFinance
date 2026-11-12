import {
  CreateTransferUseCase,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  ResolveAuthenticatedActorUseCase,
} from '@seshat/application';
import { Currency, Money, Transfer } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const actorId = '0b6f1a52-9d0e-4c8e-9a51-6f3d2c1b0a99';
const idempotencyKey = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const payload = {
  amount: '50.00',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  description: null,
  destinationAccountId: '3f0e8c1a-6b2d-4e9f-8a7c-5d4b3a2f1e0d',
  observations: null,
  occurredAt: '2026-11-12T10:00:00.000Z',
  sourceAccountId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
};

function recordedTransfer(): Transfer {
  return Transfer.create({
    amount: Money.fromDecimal('50.00', Currency.create('BRL', 2)),
    createdAt: new Date('2026-11-12T10:00:01.000Z'),
    description: null,
    destinationAccountId: payload.destinationAccountId,
    destinationTransactionId: 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f',
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    observations: null,
    occurredAt: new Date(payload.occurredAt),
    ownerId: actorId,
    sourceAccountId: payload.sourceAccountId,
    sourceTransactionId: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
  });
}

describe('Transfer creation Idempotency-Key (US-032)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const createTransfer = {
    execute: vi.fn<CreateTransferUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    createTransfer.execute.mockReset();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(CreateTransferUseCase)
      .useValue(createTransfer)
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

  it.each([
    ['missing', undefined],
    ['not a UUID', 'retry-1'],
    ['not version 4', '6f1d2c3b-4a5e-1f60-8a7b-9c0d1e2f3a4b'],
  ])('rejects a %s key without calling the use case', async (_, key) => {
    const response = await application.inject({
      headers: {
        authorization: 'Bearer token',
        ...(key === undefined ? {} : { 'idempotency-key': key }),
      },
      method: 'POST',
      payload,
      url: '/api/v1/transfers',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
    expect(createTransfer.execute).not.toHaveBeenCalled();
  });

  it('passes the key to the use case and returns the same body on replay', async () => {
    const transfer = recordedTransfer();
    createTransfer.execute.mockResolvedValue(transfer);
    const request = {
      headers: {
        authorization: 'Bearer token',
        'idempotency-key': idempotencyKey,
      },
      method: 'POST',
      payload,
      url: '/api/v1/transfers',
    } as const;

    const first = await application.inject(request);
    const second = await application.inject(request);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(createTransfer.execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, idempotencyKey }),
    );
  });

  it.each([
    [new IdempotencyConflictError(), 409, 'CONFLICT'],
    [new InvalidIdempotencyKeyError(), 400, 'INVALID_REQUEST'],
  ])('maps %s', async (error, status, code) => {
    createTransfer.execute.mockRejectedValue(error);

    const response = await application.inject({
      headers: {
        authorization: 'Bearer token',
        'idempotency-key': idempotencyKey,
      },
      method: 'POST',
      payload,
      url: '/api/v1/transfers',
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: { code } });
  });
});
