import {
  AccountReserveVersionConflictError,
  GetAccountAvailabilityUseCase,
  GetOwnedAvailabilitySummaryUseCase,
  ReserveAccountNotFoundError,
  ResolveAuthenticatedActorUseCase,
  SetAccountReserveUseCase,
  type AccountAvailabilityView,
} from '@seshat/application';
import {
  AccountReserveExceedsBalanceError,
  calculateAccountAvailability,
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

const actorId = 'actor-r';
const accountId = '3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d';
const key = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const brl = Currency.create('BRL', 2);
const auth = { authorization: 'Bearer actor-r-token' };

function view(book = '100.00', reserve = '30.00'): AccountAvailabilityView {
  return {
    accountId,
    availability: calculateAccountAvailability(
      Money.fromDecimal(book, brl),
      Money.fromDecimal(reserve, brl),
    ),
    reserveVersion: 1,
  };
}

describe('Account reserve HTTP contract (US-051)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const set = { execute: vi.fn<SetAccountReserveUseCase['execute']>() };
  const get = { execute: vi.fn<GetAccountAvailabilityUseCase['execute']>() };
  const summary = {
    execute: vi.fn<GetOwnedAvailabilitySummaryUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    set.execute.mockReset().mockResolvedValue(view());
    get.execute.mockReset().mockResolvedValue(view('10.00'));
    summary.execute.mockReset().mockResolvedValue({
      accounts: [view()],
      totalsByCurrency: [view().availability],
    });
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(SetAccountReserveUseCase)
      .useValue(set)
      .overrideProvider(GetAccountAvailabilityUseCase)
      .useValue(get)
      .overrideProvider(GetOwnedAvailabilitySummaryUseCase)
      .useValue(summary)
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
      url: '/api/v1/accounts/availability',
    });
    expect(response.statusCode).toBe(401);
  });

  it('sets a reserve and returns book, reserve and available apart', async () => {
    const response = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'PUT',
      payload: { amount: '30.00', expectedVersion: 0 },
      url: `/api/v1/accounts/${accountId}/reserve`,
    });

    expect(response.statusCode).toBe(200);
    expect(set.execute).toHaveBeenCalledWith({
      accountId,
      actorId,
      amount: '30.00',
      expectedVersion: 0,
      idempotencyKey: key,
    });
    expect(response.json()).toEqual({
      accountId,
      available: { amount: '70.00', currencyCode: 'BRL' },
      book: { amount: '100.00', currencyCode: 'BRL' },
      reserveAboveBalance: false,
      reserveVersion: 1,
      reserved: { amount: '30.00', currencyCode: 'BRL' },
    });
  });

  it('reads the warning and the per-currency summary', async () => {
    const one = await application.inject({
      headers: auth,
      method: 'GET',
      url: `/api/v1/accounts/${accountId}/reserve`,
    });
    const all = await application.inject({
      headers: auth,
      method: 'GET',
      url: '/api/v1/accounts/availability',
    });

    expect(one.json()).toMatchObject({
      available: { amount: '-20.00' },
      reserveAboveBalance: true,
    });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toMatchObject({
      totalsByCurrency: [
        { available: { amount: '70.00', currencyCode: 'BRL' } },
      ],
    });
  });

  it('rejects a missing key and a negative amount before the use case', async () => {
    const noKey = await application.inject({
      headers: auth,
      method: 'PUT',
      payload: { amount: '30.00', expectedVersion: 0 },
      url: `/api/v1/accounts/${accountId}/reserve`,
    });
    const negative = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'PUT',
      payload: { amount: '-1.00', expectedVersion: 0 },
      url: `/api/v1/accounts/${accountId}/reserve`,
    });

    expect(noKey.statusCode).toBe(400);
    expect(negative.statusCode).toBe(400);
    expect(set.execute).not.toHaveBeenCalled();
  });

  it('maps balance, ownership and version errors', async () => {
    set.execute
      .mockRejectedValueOnce(new AccountReserveExceedsBalanceError())
      .mockRejectedValueOnce(new AccountReserveVersionConflictError());
    get.execute.mockRejectedValueOnce(new ReserveAccountNotFoundError());
    const put = (): ReturnType<NestFastifyApplication['inject']> =>
      application.inject({
        headers: { ...auth, 'idempotency-key': key },
        method: 'PUT',
        payload: { amount: '120.00', expectedVersion: 0 },
        url: `/api/v1/accounts/${accountId}/reserve`,
      });

    expect((await put()).statusCode).toBe(422);
    expect((await put()).statusCode).toBe(409);
    expect(
      (
        await application.inject({
          headers: auth,
          method: 'GET',
          url: `/api/v1/accounts/${accountId}/reserve`,
        })
      ).statusCode,
    ).toBe(404);
  });
});
