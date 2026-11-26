import {
  BudgetOverlapError,
  ChangeBudgetLifecycleUseCase,
  ChangeBudgetUseCase,
  CreateBudgetUseCase,
  ListBudgetsUseCase,
  ResolveAuthenticatedActorUseCase,
  type BudgetView,
} from '@seshat/application';
import {
  Budget,
  calculateBudgetConsumption,
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

const actorId = 'actor-b2';
const budgetId = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2e';
const categoryId = '7b6c5d4e-3f20-4b1c-8d9e-8f7a6b5c4d3f';
const key = '8c7d6e5f-4031-4c2d-9e0f-9a8b7c6d5e40';
const brl = Currency.create('BRL', 2);
const money = (amount: string): Money => Money.fromDecimal(amount, brl);
const auth = { authorization: 'Bearer actor-b2-token' };

function view(realized = '120.00'): BudgetView {
  return {
    budget: Budget.create({
      createdAt: new Date('2026-11-01T12:00:00Z'),
      dimension: { id: categoryId, kind: 'category' },
      effectiveFrom: '2026-11',
      id: budgetId,
      limit: money('500.00'),
      name: 'Mercado',
      ownerId: actorId,
    }),
    consumption: calculateBudgetConsumption(money('500.00'), money(realized)),
    countedEntries: 1,
    month: '2026-11',
    otherCurrencyEntries: 0,
  };
}

const body = {
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  dimension: { id: categoryId, kind: 'category' },
  limit: '500.00',
  name: 'Mercado',
};

describe('Budget HTTP contract (US-052)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const create = { execute: vi.fn<CreateBudgetUseCase['execute']>() };
  const list = { execute: vi.fn<ListBudgetsUseCase['execute']>() };
  const change = { execute: vi.fn<ChangeBudgetUseCase['execute']>() };
  const lifecycle = {
    execute: vi.fn<ChangeBudgetLifecycleUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    for (const mock of [create, change, lifecycle]) {
      mock.execute.mockReset().mockResolvedValue(view());
    }
    list.execute.mockReset().mockResolvedValue([view('620.00')]);
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(CreateBudgetUseCase)
      .useValue(create)
      .overrideProvider(ListBudgetsUseCase)
      .useValue(list)
      .overrideProvider(ChangeBudgetUseCase)
      .useValue(change)
      .overrideProvider(ChangeBudgetLifecycleUseCase)
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

  it('requires authentication', async () => {
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/budgets',
    });
    expect(response.statusCode).toBe(401);
  });

  it('creates a budget and returns planned, realized and remaining', async () => {
    const response = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: body,
      url: '/api/v1/budgets',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      consumption: {
        exceeded: false,
        planned: { amount: '500.00' },
        realized: { amount: '120.00' },
        remaining: { amount: '380.00' },
      },
      dimension: { id: categoryId, kind: 'category' },
      month: '2026-11',
    });
  });

  it('lists a month and shows the excess as a warning', async () => {
    const response = await application.inject({
      headers: auth,
      method: 'GET',
      url: '/api/v1/budgets?month=2026-11',
    });

    expect(list.execute).toHaveBeenCalledWith({ actorId, month: '2026-11' });
    expect(response.json()).toMatchObject([
      { consumption: { excess: { amount: '120.00' }, exceeded: true } },
    ]);
  });

  it('validates input before the use case and maps overlaps', async () => {
    const badMonth = await application.inject({
      headers: auth,
      method: 'GET',
      url: '/api/v1/budgets?month=2026-13',
    });
    const noKey = await application.inject({
      headers: auth,
      method: 'POST',
      payload: body,
      url: '/api/v1/budgets',
    });
    create.execute.mockRejectedValueOnce(new BudgetOverlapError());
    const overlap = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: body,
      url: '/api/v1/budgets',
    });

    expect(badMonth.statusCode).toBe(400);
    expect(noKey.statusCode).toBe(400);
    expect(overlap.statusCode).toBe(409);
  });

  it('changes the limit from a month and archives', async () => {
    const changed = await application.inject({
      headers: auth,
      method: 'PUT',
      payload: {
        effectiveFrom: '2027-01',
        expectedVersion: 1,
        limit: '600.00',
        name: 'Mercado',
      },
      url: `/api/v1/budgets/${budgetId}`,
    });
    const archived = await application.inject({
      headers: auth,
      method: 'POST',
      payload: { action: 'archive', expectedVersion: 2 },
      url: `/api/v1/budgets/${budgetId}/lifecycle`,
    });

    expect(changed.statusCode).toBe(200);
    expect(archived.statusCode).toBe(200);
    expect(lifecycle.execute).toHaveBeenCalledWith({
      action: 'archive',
      actorId,
      budgetId,
      expectedVersion: 2,
    });
  });
});
