import {
  CorrectOwnedManualExchangeQuoteUseCase,
  CreateManualExchangeQuoteUseCase,
  GetOwnedManualExchangeQuoteUseCase,
  ListOwnedManualExchangeQuotesUseCase,
  ResolveAuthenticatedActorUseCase,
} from '@seshat/application';
import { ManualExchangeQuote } from '@seshat/domain';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const quoteId = '849857f1-54d6-45c3-8abc-0c127d6bfc98';
const quote = ManualExchangeQuote.create({
  authorId: 'b36bfe2a-f319-49a8-aade-2a536ea3af38',
  effectiveAt: new Date('2026-09-30T12:00:00.000Z'),
  id: quoteId,
  ownerId: 'b36bfe2a-f319-49a8-aade-2a536ea3af38',
  rate: '5.123456789123456789',
  recordedAt: new Date('2026-10-01T12:00:00.000Z'),
  source: 'Synthetic declared source',
  sourceCurrencyCode: 'USD',
  targetCurrencyCode: 'BRL',
  version: 1,
});

describe('manual exchange quote HTTP boundary', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockImplementation((token) =>
        Promise.resolve(
          token === 'owner-token'
            ? { id: 'b36bfe2a-f319-49a8-aade-2a536ea3af38' }
            : { id: 'e89b6ad0-7838-4a2c-9a21-c775ea78e22a' },
        ),
      ),
  };
  const createQuote = {
    execute: vi
      .fn<CreateManualExchangeQuoteUseCase['execute']>()
      .mockResolvedValue(quote),
  };
  const correctQuote = {
    execute: vi
      .fn<CorrectOwnedManualExchangeQuoteUseCase['execute']>()
      .mockResolvedValue(quote),
  };
  const getQuote = {
    execute: vi
      .fn<GetOwnedManualExchangeQuoteUseCase['execute']>()
      .mockImplementation((_id, actorId) =>
        Promise.resolve(actorId === quote.toSnapshot().ownerId ? quote : null),
      ),
  };
  const listQuotes = {
    execute: vi
      .fn<ListOwnedManualExchangeQuotesUseCase['execute']>()
      .mockResolvedValue([quote]),
  };

  beforeEach(async (): Promise<void> => {
    createQuote.execute.mockClear();
    getQuote.execute.mockClear();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(CreateManualExchangeQuoteUseCase)
      .useValue(createQuote)
      .overrideProvider(CorrectOwnedManualExchangeQuoteUseCase)
      .useValue(correctQuote)
      .overrideProvider(GetOwnedManualExchangeQuoteUseCase)
      .useValue(getQuote)
      .overrideProvider(ListOwnedManualExchangeQuotesUseCase)
      .useValue(listQuotes)
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

  it('records a textual rate for the verified actor and rejects invalid pairs', async () => {
    const body = {
      effectiveAt: '2026-09-30T12:00:00.000Z',
      rate: '5.123456789123456789',
      source: 'Synthetic declared source',
      sourceCurrencyCode: 'USD',
      targetCurrencyCode: 'BRL',
    };
    const created = await application.inject({
      headers: {
        authorization: 'Bearer owner-token',
        'idempotency-key': 'quote-create-1',
      },
      method: 'POST',
      url: '/api/v1/manual-exchange-quotes',
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ rate: body.rate, version: 1 });
    expect(createQuote.execute).toHaveBeenCalledWith({
      ...body,
      actorId: quote.toSnapshot().ownerId,
      effectiveAt: new Date(body.effectiveAt),
      idempotencyKey: 'quote-create-1',
    });

    const invalid = await application.inject({
      headers: {
        authorization: 'Bearer owner-token',
        'idempotency-key': 'quote-create-2',
      },
      method: 'POST',
      url: '/api/v1/manual-exchange-quotes',
      payload: { ...body, sourceCurrencyCode: 'JPY' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(createQuote.execute).toHaveBeenCalledTimes(1);

    const missingKey = await application.inject({
      headers: { authorization: 'Bearer owner-token' },
      method: 'POST',
      url: '/api/v1/manual-exchange-quotes',
      payload: body,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(createQuote.execute).toHaveBeenCalledTimes(1);
  });

  it('returns no quote details to another authenticated owner', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer other-token' },
      method: 'GET',
      url: `/api/v1/manual-exchange-quotes/${quoteId}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('5.123456789123456789');
    expect(getQuote.execute).toHaveBeenCalledWith(
      quoteId,
      'e89b6ad0-7838-4a2c-9a21-c775ea78e22a',
    );
  });
});
