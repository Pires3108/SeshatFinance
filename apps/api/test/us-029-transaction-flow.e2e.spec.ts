import {
  ChangeOwnedTransactionLifecycleUseCase,
  CreateTransactionUseCase,
  GetOwnedTransactionUseCase,
  OwnedTransactionNotFoundError,
  ResolveAuthenticatedActorUseCase,
  TransactionIdempotencyConflictError,
  TransactionVersionConflictError,
  UpdateOwnedTransactionUseCase,
} from '@seshat/application';
import { Currency, Money, Transaction } from '@seshat/domain';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const accountId = '7c2c7a54-73fe-49a3-b0ea-19034bf22baf';
const transactionId = '86684068-45d9-4e14-b454-f7e556b867e7';
const categoryId = '2e42589d-5865-4946-a6e0-1d74d1eecfa7';
const subcategoryId = '486537e1-2a80-4b30-819a-6835de050fb7';
const costCenterId = '63acfc04-38aa-4768-bb8c-a39ac6f82c80';
const tagId = 'df658304-04e4-45a6-bd19-fe81c797e157';
const occurredAt = '2026-09-20T11:00:00.000Z';
const body = {
  amount: '10.25',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  description: 'Synthetic description',
  kind: 'income' as const,
  observations: null,
  occurredAt,
};

describe('US-029 transaction HTTP flow', () => {
  let app: NestFastifyApplication;
  const create = { execute: vi.fn<CreateTransactionUseCase['execute']>() };
  const update = { execute: vi.fn<UpdateOwnedTransactionUseCase['execute']>() };
  const lifecycle = {
    execute: vi.fn<ChangeOwnedTransactionLifecycleUseCase['execute']>(),
  };
  const get = {
    execute: vi.fn<GetOwnedTransactionUseCase['execute']>(),
    revisions: vi.fn<GetOwnedTransactionUseCase['revisions']>(),
  };
  const actor = {
    execute: vi.fn<ResolveAuthenticatedActorUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    create.execute.mockReset();
    update.execute.mockReset();
    lifecycle.execute.mockReset();
    get.execute.mockReset();
    get.revisions.mockReset();
    get.revisions.mockResolvedValue([]);
    actor.execute.mockReset();
    actor.execute.mockResolvedValue({ id: 'actor-a' });
    const transaction = Transaction.create({
      accountId,
      amount: Money.fromDecimal('10.25', Currency.create('BRL', 2)),
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      description: body.description,
      id: transactionId,
      kind: 'income',
      occurredAt: new Date(occurredAt),
      ownerId: 'actor-a',
    });
    create.execute.mockResolvedValue(transaction);
    update.execute.mockResolvedValue(transaction);
    lifecycle.execute.mockResolvedValue(transaction);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(actor)
      .overrideProvider(CreateTransactionUseCase)
      .useValue(create)
      .overrideProvider(GetOwnedTransactionUseCase)
      .useValue(get)
      .overrideProvider(UpdateOwnedTransactionUseCase)
      .useValue(update)
      .overrideProvider(ChangeOwnedTransactionLifecycleUseCase)
      .useValue(lifecycle)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    configureApplication(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async (): Promise<void> => {
    await app.close();
  });

  it('forwards optional classification, tags, cost center and free-text counterparty under the authenticated owner', async () => {
    const payload = {
      ...body,
      categoryId,
      subcategoryId,
      costCenterId,
      tagIds: [tagId],
      counterpartyName: 'Synthetic merchant',
    };
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accountId}/transactions`,
      headers: { authorization: 'Bearer test-token' },
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(create.execute).toHaveBeenCalledWith({
      ...payload,
      accountId,
      actorId: 'actor-a',
      occurredAt: new Date(occurredAt),
    });
    expect(response.json()).toMatchObject({
      id: transactionId,
      amount: '10.25',
      currencyCode: 'BRL',
    });
  });

  it('rejects mutually exclusive counterparty inputs before writing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accountId}/transactions`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        ...body,
        counterpartyId: categoryId,
        counterpartyName: 'Synthetic merchant',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(create.execute).not.toHaveBeenCalled();
  });

  it('forwards the same idempotency key on a replay and reports a conflicting payload', async () => {
    const request = {
      method: 'POST' as const,
      url: `/api/v1/accounts/${accountId}/transactions`,
      headers: {
        authorization: 'Bearer test-token',
        'idempotency-key': 'synthetic-key',
      },
      payload: body,
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(first.json()).toEqual(replay.json());
    expect(create.execute).toHaveBeenCalledTimes(2);
    expect(create.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-a',
        idempotencyKey: 'synthetic-key',
      }),
    );
    create.execute.mockRejectedValueOnce(
      new TransactionIdempotencyConflictError(),
    );
    const conflict = await app.inject({
      ...request,
      payload: { ...body, amount: '11.25' },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('returns conflict for a stale expected version on edit', async () => {
    update.execute.mockRejectedValueOnce(new TransactionVersionConflictError());
    const payload = {
      amount: '7.50',
      description: null,
      kind: 'expense' as const,
      observations: null,
      occurredAt,
      expectedVersion: 1,
    };
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${transactionId}`,
      headers: { authorization: 'Bearer test-token' },
      payload,
    });
    expect(response.statusCode).toBe(409);
    expect(update.execute).toHaveBeenCalledWith({
      ...payload,
      actorId: 'actor-a',
      transactionId,
      occurredAt: new Date(occurredAt),
    });
  });

  it('requests revision history only for the authenticated owner', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${transactionId}/revisions`,
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(get.revisions).toHaveBeenCalledWith(transactionId, 'actor-a');
    get.revisions.mockRejectedValueOnce(new OwnedTransactionNotFoundError());
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${transactionId}/revisions`,
      headers: { authorization: 'Bearer test-token' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('rejects unauthenticated creation and editing before use cases', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${accountId}/transactions`,
      payload: body,
    });
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${transactionId}`,
      payload: {
        ...body,
        currencyCode: undefined,
        currencyMinorUnitScale: undefined,
      },
    });
    expect(created.statusCode).toBe(401);
    expect(edited.statusCode).toBe(401);
    expect(create.execute).not.toHaveBeenCalled();
    expect(update.execute).not.toHaveBeenCalled();
  });

  it('forwards an expense edit and archive without losing owner context', async () => {
    const payload = {
      amount: '7.50',
      description: null,
      kind: 'expense' as const,
      observations: null,
      occurredAt,
    };
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${transactionId}`,
      headers: { authorization: 'Bearer test-token' },
      payload,
    });
    const archived = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${transactionId}/lifecycle`,
      headers: { authorization: 'Bearer test-token' },
      payload: { action: 'archive' },
    });
    expect(edited.statusCode).toBe(200);
    expect(archived.statusCode).toBe(200);
    expect(update.execute).toHaveBeenCalledWith({
      ...payload,
      actorId: 'actor-a',
      transactionId,
      occurredAt: new Date(occurredAt),
    });
    expect(lifecycle.execute).toHaveBeenCalledWith({
      action: 'archive',
      actorId: 'actor-a',
      transactionId,
    });
  });
});
