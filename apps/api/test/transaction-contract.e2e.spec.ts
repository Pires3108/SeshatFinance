import {
  CreateTransactionUseCase,
  ResolveAuthenticatedActorUseCase,
} from '@seshat/application';
import { Currency, Money, Transaction } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const accountId = '7c2c7a54-73fe-49a3-b0ea-19034bf22baf';
const body = {
  amount: '10.25',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  description: null,
  kind: 'income' as const,
  observations: null,
  occurredAt: '2026-09-20T11:00:00.000Z',
};
const document = JSON.parse(
  readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
) as {
  paths: Record<
    string,
    {
      post: {
        requestBody: {
          content: Record<string, { schema: { required: string[] } }>;
        };
        responses: Record<
          string,
          {
            content: Record<
              string,
              {
                schema: {
                  required: string[];
                  properties: Record<string, unknown>;
                };
              }
            >;
          }
        >;
      };
    }
  >;
};
const operation =
  document.paths['/api/v1/accounts/{accountId}/transactions']?.post;

describe('Transaction POST contract', () => {
  let application: NestFastifyApplication;
  const execute = vi.fn<CreateTransactionUseCase['execute']>();
  const resolveActor = {
    execute: vi.fn<ResolveAuthenticatedActorUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    execute.mockReset();
    resolveActor.execute.mockReset();
    resolveActor.execute.mockResolvedValue({ id: 'actor-id' });
    execute.mockResolvedValue(
      Transaction.create({
        accountId,
        amount: Money.fromDecimal('10.25', Currency.create('BRL', 2)),
        createdAt: new Date('2026-09-20T12:00:00.000Z'),
        description: null,
        id: '86684068-45d9-4e14-b454-f7e556b867e7',
        kind: 'income',
        occurredAt: new Date(body.occurredAt),
        ownerId: 'actor-id',
      }),
    );
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(CreateTransactionUseCase)
      .useValue({ execute })
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

  it('records a valid authenticated request with the documented response shape', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer test-token' },
      method: 'POST',
      payload: body,
      url: `/api/v1/accounts/${accountId}/transactions`,
    });
    expect(response.statusCode).toBe(201);
    expect(execute).toHaveBeenCalledWith({
      accountId,
      actorId: 'actor-id',
      ...body,
      occurredAt: new Date(body.occurredAt),
    });
    const schema =
      operation?.responses['201']?.content['application/json']?.schema;
    expect(schema).toBeDefined();
    expect(Object.keys(response.json())).toEqual(
      expect.arrayContaining(schema!.required),
    );
    expect(Object.keys(response.json()).sort()).toEqual(
      Object.keys(schema!.properties).sort(),
    );
  });

  it.each([
    ['missing currency', { ...body, currencyCode: undefined }],
    ['invalid scale', { ...body, currencyMinorUnitScale: 19 }],
  ])(
    'rejects %s before the use case with the documented error shape',
    async (_name, payload) => {
      const response = await application.inject({
        headers: { authorization: 'Bearer test-token' },
        method: 'POST',
        payload,
        url: `/api/v1/accounts/${accountId}/transactions`,
      });
      expect(response.statusCode).toBe(400);
      expect(execute).not.toHaveBeenCalled();
      const error = response.json() as { error: Record<string, unknown> };
      expect(error.error.code).toBe('INVALID_REQUEST');
      const schema =
        operation?.responses['400']?.content['application/json']?.schema;
      expect(schema).toBeDefined();
      expect(Object.keys(error)).toEqual(schema!.required);
      expect(Object.keys(error.error).sort()).toEqual(
        Object.keys(
          (schema!.properties.error as { properties: Record<string, unknown> })
            .properties,
        ).sort(),
      );
    },
  );

  it('keeps documented required money fields in the request', () => {
    const schema = operation?.requestBody.content['application/json']?.schema;
    expect(schema?.required).toEqual(
      expect.arrayContaining([
        'amount',
        'currencyCode',
        'currencyMinorUnitScale',
      ]),
    );
  });
});
