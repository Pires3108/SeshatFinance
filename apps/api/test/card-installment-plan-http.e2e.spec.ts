import {
  CardInstallmentInvoiceClosedError,
  CardPurchaseAlreadyInstalledError,
  CardPurchaseNotFoundError,
  GetCardInstallmentPlanUseCase,
  PreviewCardInstallmentPlanUseCase,
  RegisterCardInstallmentPlanUseCase,
  ResolveAuthenticatedActorUseCase,
} from '@seshat/application';
import {
  calculateInstallmentPlan,
  CardCycleSchedule,
  CardInstallmentPlan,
  Currency,
  InterestRate,
  InvalidInterestRateError,
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

const cardId = '7943309c-9c98-41d4-aa61-4811b12633f5';
const purchaseId = '0a4b9c3d-2e1f-4a5b-8c7d-6e5f4a3b2c1d';
const key = '6f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f';
const actorId = 'actor-b';
const url = `/api/v1/credit-cards/${cardId}/purchases/${purchaseId}/installment-plan`;
const brl = Currency.create('BRL', 2);
const schedule = CardCycleSchedule.create({
  closingBoundary: 'next-cycle',
  closingDay: 28,
  dueDay: 7,
});
const cycles = [11, 12].map((month) =>
  schedule.cycleClosingIn(2026, month, () => false),
);
const compound = {
  method: 'compound',
  percentPerPeriod: '1',
  periodicity: 'monthly',
} as const;
const calculated = calculateInstallmentPlan({
  count: 2,
  principal: Money.fromDecimal('100.00', brl),
  rate: InterestRate.create(compound),
});

describe('Card installment plan HTTP boundary (US-044)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const preview = {
    execute: vi.fn<PreviewCardInstallmentPlanUseCase['execute']>(),
  };
  const register = {
    execute: vi.fn<RegisterCardInstallmentPlanUseCase['execute']>(),
  };
  const get = { execute: vi.fn<GetCardInstallmentPlanUseCase['execute']>() };

  beforeEach(async (): Promise<void> => {
    preview.execute.mockReset();
    register.execute.mockReset();
    get.execute.mockReset();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(PreviewCardInstallmentPlanUseCase)
      .useValue(preview)
      .overrideProvider(RegisterCardInstallmentPlanUseCase)
      .useValue(register)
      .overrideProvider(GetCardInstallmentPlanUseCase)
      .useValue(get)
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

  const post = (
    path: string,
    payload: unknown,
    extra: Record<string, string> = {},
  ): ReturnType<NestFastifyApplication['inject']> =>
    application.inject({
      headers: { authorization: 'Bearer actor-b-token', ...extra },
      method: 'POST',
      payload: payload as Record<string, unknown>,
      url: path,
    });

  it('previews principal, interest, total and due dates without recording', async () => {
    preview.execute.mockResolvedValue({ cycles, plan: calculated });

    const response = await post(`${url}/preview`, { count: 2, rate: compound });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      interest: '2.01',
      principal: '100.00',
      total: '102.01',
      installments: [
        { amount: '51.00', cycleClosesOn: '2026-11-28', dueOn: '2026-12-07' },
        { amount: '51.01', cycleClosesOn: '2026-12-28', dueOn: '2027-01-07' },
      ],
    });
    expect(preview.execute).toHaveBeenCalledWith({
      actorId,
      cardId,
      count: 2,
      purchaseId,
      rate: compound,
    });
    expect(register.execute).not.toHaveBeenCalled();
  });

  it('records the plan for the verified actor with the idempotency key', async () => {
    register.execute.mockResolvedValue(
      CardInstallmentPlan.create({
        cardId,
        createdAt: new Date('2026-11-16T12:00:00.000Z'),
        cycles: cycles.map((cycle) => cycle.closesOn),
        id: '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a',
        installmentIds: [
          '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9',
          '2b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9',
        ],
        ownerId: actorId,
        plan: calculated,
        purchaseId,
      }),
    );

    const response = await post(
      url,
      { count: 2, rate: compound },
      { 'idempotency-key': key },
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      count: 2,
      purchaseId,
      rate: compound,
      status: 'active',
      total: '102.01',
    });
    expect(register.execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, idempotencyKey: key, purchaseId }),
    );
  });

  it('requires an idempotency key to record', async () => {
    const response = await post(url, { count: 2 });

    expect(response.statusCode).toBe(400);
    expect(register.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['zero installments', { count: 0 }],
    ['too many installments', { count: 421 }],
    [
      'rate without periodicity',
      { count: 2, rate: { method: 'simple', percentPerPeriod: '1' } },
    ],
    ['annual rate', { count: 2, rate: { ...compound, periodicity: 'yearly' } }],
    [
      'rate with seven places',
      { count: 2, rate: { ...compound, percentPerPeriod: '1.0000001' } },
    ],
  ])('rejects %s before any use case runs', async (_label, payload) => {
    const response = await post(`${url}/preview`, payload);

    expect(response.statusCode).toBe(400);
    expect(preview.execute).not.toHaveBeenCalled();
  });

  it.each([
    [new CardPurchaseNotFoundError(), 404],
    [new CardPurchaseAlreadyInstalledError(), 409],
    [new CardInstallmentInvoiceClosedError(), 422],
    [new InvalidInterestRateError('above 100'), 400],
  ])('maps %s to %i', async (error, status) => {
    register.execute.mockRejectedValue(error);

    const response = await post(url, { count: 2 }, { 'idempotency-key': key });

    expect(response.statusCode).toBe(status);
  });

  it('returns 404 when the purchase has no plan', async () => {
    get.execute.mockResolvedValue(null);

    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url,
    });

    expect(response.statusCode).toBe(404);
    expect(get.execute).toHaveBeenCalledWith({ actorId, cardId, purchaseId });
  });

  it('rejects anonymous calls', async () => {
    const response = await application.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(401);
  });
});
