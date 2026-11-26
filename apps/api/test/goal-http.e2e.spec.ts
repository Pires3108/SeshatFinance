import {
  ChangeGoalLifecycleUseCase,
  CreateGoalUseCase,
  GetAccountGoalImpactUseCase,
  GetGoalUseCase,
  GoalNotFoundError,
  GoalShareExceedsBalanceError,
  GoalVersionConflictError,
  ListGoalsUseCase,
  ResolveAuthenticatedActorUseCase,
  UnlinkGoalAccountUseCase,
  UpdateGoalUseCase,
  type GoalView,
} from '@seshat/application';
import {
  calculateGoalProgress,
  CivilDate,
  Currency,
  Goal,
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

const actorId = 'actor-b';
const goalId = '5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const accountId = '7c6b5a4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const key = '6f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f';
const usd = Currency.create('USD', 2);
const brl = Currency.create('BRL', 2);
const auth = { authorization: 'Bearer actor-b-token' };

function view(): GoalView {
  const goal = Goal.create({
    createdAt: new Date('2026-11-20T12:00:00Z'),
    deadline: CivilDate.parse('2026-12-31'),
    id: goalId,
    initialAmount: null,
    links: [{ accountId, share: { kind: 'full' } }],
    mode: 'linked',
    name: 'Viagem',
    ownerId: actorId,
    target: Money.fromDecimal('500.00', brl),
  });
  const balance = Money.fromDecimal('80.00', usd);
  return {
    accounts: [
      { balance, id: accountId, lifecycle: 'active', name: 'Conta USD' },
    ],
    goal,
    progress: calculateGoalProgress({
      goal,
      now: new Date('2026-11-20T12:00:00Z'),
      positions: new Map([
        [
          accountId,
          {
            accountId,
            balance,
            declaredAmountShares: Money.fromMinorUnits(0n, usd),
            lifecycle: 'active',
          },
        ],
      ]),
      quotes: [],
      today: CivilDate.parse('2026-11-20'),
    }),
  };
}

const body = {
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  deadline: '2026-12-31',
  links: [{ accountId, share: { kind: 'full' } }],
  mode: 'linked',
  name: 'Viagem',
  target: '500.00',
};

describe('Goal HTTP contract (US-049)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const create = { execute: vi.fn<CreateGoalUseCase['execute']>() };
  const list = { execute: vi.fn<ListGoalsUseCase['execute']>() };
  const get = { execute: vi.fn<GetGoalUseCase['execute']>() };
  const update = { execute: vi.fn<UpdateGoalUseCase['execute']>() };
  const lifecycle = { execute: vi.fn<ChangeGoalLifecycleUseCase['execute']>() };
  const unlink = { execute: vi.fn<UnlinkGoalAccountUseCase['execute']>() };
  const impact = { execute: vi.fn<GetAccountGoalImpactUseCase['execute']>() };

  beforeEach(async (): Promise<void> => {
    for (const mock of [create, get, update, lifecycle, unlink]) {
      mock.execute.mockReset().mockResolvedValue(view());
    }
    list.execute.mockReset().mockResolvedValue([view()]);
    impact.execute.mockReset().mockResolvedValue([view()]);
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(CreateGoalUseCase)
      .useValue(create)
      .overrideProvider(ListGoalsUseCase)
      .useValue(list)
      .overrideProvider(GetGoalUseCase)
      .useValue(get)
      .overrideProvider(UpdateGoalUseCase)
      .useValue(update)
      .overrideProvider(ChangeGoalLifecycleUseCase)
      .useValue(lifecycle)
      .overrideProvider(UnlinkGoalAccountUseCase)
      .useValue(unlink)
      .overrideProvider(GetAccountGoalImpactUseCase)
      .useValue(impact)
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
      url: '/api/v1/goals',
    });
    expect(response.statusCode).toBe(401);
  });

  it('creates a goal for the authenticated actor and shows the USD value without a quote', async () => {
    const response = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: body,
      url: '/api/v1/goals',
    });

    expect(response.statusCode).toBe(201);
    expect(create.execute).toHaveBeenCalledWith(
      expect.objectContaining({ actorId, idempotencyKey: key, name: 'Viagem' }),
    );
    expect(response.json()).toMatchObject({
      links: [
        {
          accountName: 'Conta USD',
          conversion: { amount: null, status: 'unavailable' },
          counted: { amount: '80.00', currencyCode: 'USD' },
        },
      ],
      progress: { accumulated: null, percent: null, status: 'indeterminate' },
      target: { amount: '500.00', currencyCode: 'BRL' },
    });
  });

  it('rejects a missing idempotency key and invalid input before the use case', async () => {
    const noKey = await application.inject({
      headers: auth,
      method: 'POST',
      payload: body,
      url: '/api/v1/goals',
    });
    const invalid = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: { ...body, target: '-1' },
      url: '/api/v1/goals',
    });

    expect(noKey.statusCode).toBe(400);
    expect(invalid.statusCode).toBe(400);
    expect(create.execute).not.toHaveBeenCalled();
  });

  it('maps share, ownership and version errors', async () => {
    create.execute.mockRejectedValueOnce(new GoalShareExceedsBalanceError());
    get.execute.mockRejectedValueOnce(new GoalNotFoundError());
    update.execute.mockRejectedValueOnce(new GoalVersionConflictError());

    const share = await application.inject({
      headers: { ...auth, 'idempotency-key': key },
      method: 'POST',
      payload: body,
      url: '/api/v1/goals',
    });
    const foreign = await application.inject({
      headers: auth,
      method: 'GET',
      url: `/api/v1/goals/${goalId}`,
    });
    const stale = await application.inject({
      headers: auth,
      method: 'PUT',
      payload: { ...body, expectedVersion: 1 },
      url: `/api/v1/goals/${goalId}`,
    });

    expect(share.statusCode).toBe(422);
    expect(foreign.statusCode).toBe(404);
    expect(stale.statusCode).toBe(409);
  });

  it('changes the lifecycle, unlinks an account and lists the account impact', async () => {
    const paused = await application.inject({
      headers: auth,
      method: 'POST',
      payload: { action: 'pause', expectedVersion: 1 },
      url: `/api/v1/goals/${goalId}/lifecycle`,
    });
    const unlinked = await application.inject({
      headers: auth,
      method: 'POST',
      payload: { accountId, expectedVersion: 1 },
      url: `/api/v1/goals/${goalId}/unlink-account`,
    });
    const impacted = await application.inject({
      headers: auth,
      method: 'GET',
      url: `/api/v1/goals/account-impact/${accountId}`,
    });

    expect(paused.statusCode).toBe(200);
    expect(lifecycle.execute).toHaveBeenCalledWith({
      action: 'pause',
      actorId,
      expectedVersion: 1,
      goalId,
    });
    expect(unlinked.statusCode).toBe(200);
    expect(impacted.statusCode).toBe(200);
    expect(impact.execute).toHaveBeenCalledWith({ accountId, actorId });
  });
});
