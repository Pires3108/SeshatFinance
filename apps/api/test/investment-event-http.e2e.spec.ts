import {
  ChangeInvestmentEventLifecycleUseCase,
  InvestmentCustodyExceededError,
  InvestmentNotFoundError,
  ListInvestmentEventsUseCase,
  RecordInvestmentEventUseCase,
  ResolveAuthenticatedActorUseCase,
} from '@seshat/application';
import {
  CivilDate,
  Currency,
  InvalidInvestmentEventError,
  Investment,
  InvestmentEvent,
  InvestmentType,
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

const actorId = 'actor-e1';
const investmentId = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const eventId = '7c6b5a49-3e2d-4c1b-8a09-f8e7d6c5b4a3';
const accountId = 'c722103a-e28a-482c-b6e9-e3320d8a44e3';
const transactionId = '5b4a3928-1d0c-4b9a-8f7e-6d5c4b3a2918';
const key = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const auth = { authorization: 'Bearer actor-e1-token' };
const brl = Currency.create('BRL', 2);

function event(): InvestmentEvent {
  return InvestmentEvent.create({
    accountId,
    amount: Money.fromDecimal('1500.00', brl),
    createdAt: new Date('2026-11-27T12:00:00Z'),
    id: eventId,
    investment: Investment.create({
      code: 'PETR4',
      contractedRate: null,
      createdAt: new Date('2026-11-27T12:00:00Z'),
      currency: brl,
      id: investmentId,
      institution: 'Corretora Exemplo',
      liquidity: { days: 2, kind: 'd-plus' },
      maturityDate: null,
      name: 'Petrobras PN',
      ownerId: actorId,
      startDate: CivilDate.parse('2026-03-02'),
      type: InvestmentType.create('stock'),
    }),
    kind: 'contribution',
    note: null,
    occurredAt: new Date('2026-03-10T15:00:00Z'),
    quantity: '100',
    timeZone: 'America/Sao_Paulo',
    transactionId,
    unitPrice: '15',
  });
}

const body = {
  accountId,
  amount: '1500.00',
  kind: 'contribution',
  occurredAt: '2026-03-10T15:00:00.000Z',
  quantity: '100',
  timeZone: 'America/Sao_Paulo',
  unitPrice: '15',
};
const eventsUrl = `/api/v1/investments/${investmentId}/events`;
const lifecycleUrl = `/api/v1/investment-events/${eventId}/lifecycle`;

describe('Investment event HTTP contract (US-055)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const record = { execute: vi.fn<RecordInvestmentEventUseCase['execute']>() };
  const list = { execute: vi.fn<ListInvestmentEventsUseCase['execute']>() };
  const lifecycle = {
    execute: vi.fn<ChangeInvestmentEventLifecycleUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    record.execute.mockReset().mockResolvedValue(event());
    lifecycle.execute.mockReset().mockResolvedValue(event());
    list.execute.mockReset().mockResolvedValue([event()]);
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(RecordInvestmentEventUseCase)
      .useValue(record)
      .overrideProvider(ListInvestmentEventsUseCase)
      .useValue(list)
      .overrideProvider(ChangeInvestmentEventLifecycleUseCase)
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

  it('records an aporte with its linked account entry', async () => {
    const response = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: body,
      url: eventsUrl,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      amount: '1500.00',
      currencyCode: 'BRL',
      id: eventId,
      kind: 'contribution',
      occurredOn: '2026-03-10',
      quantity: '100',
      transactionId,
    });
    expect(record.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        idempotencyKey: key,
        investmentId,
        occurredAt: new Date('2026-03-10T15:00:00.000Z'),
      }),
    );
  });

  it('requires an idempotency key and decimal strings', async () => {
    const missingKey = await application.inject({
      headers: auth,
      method: 'POST',
      payload: body,
      url: eventsUrl,
    });
    expect(missingKey.statusCode).toBe(400);
    const numeric = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: { ...body, quantity: 100 },
      url: eventsUrl,
    });
    expect(numeric.statusCode).toBe(400);
    expect(record.execute).not.toHaveBeenCalled();
  });

  it('maps domain and custody failures', async () => {
    record.execute.mockRejectedValueOnce(new InvestmentCustodyExceededError());
    const custody = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: { ...body, kind: 'redemption' },
      url: eventsUrl,
    });
    expect(custody.statusCode).toBe(422);

    record.execute.mockRejectedValueOnce(
      new InvalidInvestmentEventError('Fees and taxes do not move an account.'),
    );
    const invalid = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: { ...body, kind: 'fee', quantity: null, unitPrice: null },
      url: eventsUrl,
    });
    expect(invalid.statusCode).toBe(400);

    list.execute.mockRejectedValueOnce(new InvestmentNotFoundError());
    const missing = await application.inject({
      headers: auth,
      method: 'GET',
      url: eventsUrl,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('lists events and moves one to the trash with its version', async () => {
    const listed = await application.inject({
      headers: auth,
      method: 'GET',
      url: eventsUrl,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const trashed = await application.inject({
      headers: auth,
      method: 'POST',
      payload: { action: 'trash', expectedVersion: 1 },
      url: lifecycleUrl,
    });
    expect(trashed.statusCode).toBe(200);
    expect(lifecycle.execute).toHaveBeenCalledWith({
      action: 'trash',
      actorId,
      eventId,
      expectedVersion: 1,
    });

    lifecycle.execute.mockRejectedValueOnce(
      new InvalidInvestmentEventError('The event is already trashed.'),
    );
    const repeated = await application.inject({
      headers: auth,
      method: 'POST',
      payload: { action: 'trash', expectedVersion: 2 },
      url: lifecycleUrl,
    });
    expect(repeated.statusCode).toBe(422);
  });
});
