import {
  CreateLoanUseCase,
  GetLoanUseCase,
  ListLoansUseCase,
  LoanNotFoundError,
  RecordLoanEventUseCase,
  RenegotiateLoanUseCase,
  ResolveAuthenticatedActorUseCase,
  withState,
} from '@seshat/application';
import {
  CivilDate,
  Currency,
  Loan,
  LoanPaymentExcessUnclassifiedError,
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
const loanId = '5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const key = '6f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f';
const authorization = 'Bearer actor-b-token';

const loan = Loan.create({
  businessDayRule: 'none',
  contractedOn: CivilDate.parse('2026-01-10'),
  count: 1,
  createdAt: new Date('2026-01-10T12:00:00.000Z'),
  description: 'Empréstimo ao Pedro',
  direction: 'receivable',
  firstDueOn: CivilDate.parse('2026-02-10'),
  id: loanId,
  isHoliday: () => false,
  ownerId: actorId,
  principal: Money.fromDecimal('100.00', Currency.create('BRL', 2)),
  profile: 'constant',
  rate: null,
});
const view = withState(
  {
    events: [
      {
        allocationOrder: null,
        amount: {
          amount: '40.00',
          currency: { code: 'BRL', minorUnitScale: 2 },
        },
        declaredFee: null,
        excess: null,
        id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        kind: 'payment',
        occurredOn: '2026-02-10',
        recordedAt: new Date('2026-02-10T12:00:00.000Z'),
      },
    ],
    loan,
  },
  CivilDate.parse('2026-02-10'),
);

const terms = {
  businessDayRule: 'none',
  contractedOn: '2026-01-10',
  count: 1,
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  description: 'Empréstimo ao Pedro',
  firstDueOn: '2026-02-10',
  principal: '100.00',
  profile: 'constant',
};

describe('Loan HTTP boundary (US-047)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const create = { execute: vi.fn<CreateLoanUseCase['execute']>() };
  const list = { execute: vi.fn<ListLoansUseCase['execute']>() };
  const get = { execute: vi.fn<GetLoanUseCase['execute']>() };
  const record = { execute: vi.fn<RecordLoanEventUseCase['execute']>() };
  const renegotiate = { execute: vi.fn<RenegotiateLoanUseCase['execute']>() };

  beforeEach(async (): Promise<void> => {
    for (const mock of [create, list, get, record, renegotiate]) {
      mock.execute.mockReset();
    }
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(CreateLoanUseCase)
      .useValue(create)
      .overrideProvider(ListLoansUseCase)
      .useValue(list)
      .overrideProvider(GetLoanUseCase)
      .useValue(get)
      .overrideProvider(RecordLoanEventUseCase)
      .useValue(record)
      .overrideProvider(RenegotiateLoanUseCase)
      .useValue(renegotiate)
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

  it('records a loan for the verified actor and returns schedule and balance', async () => {
    create.execute.mockResolvedValue(view);

    const response = await application.inject({
      headers: { authorization, 'idempotency-key': key },
      method: 'POST',
      payload: { ...terms, direction: 'receivable' },
      url: '/api/v1/loans',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      direction: 'receivable',
      events: [{ amount: '40.00', kind: 'payment', reversed: false }],
      installments: [
        { amount: '100.00', remaining: '60.00', situation: 'partial' },
      ],
      interest: '0.00',
      pending: '60.00',
      status: 'active',
      total: '100.00',
    });
    expect(create.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        direction: 'receivable',
        idempotencyKey: key,
      }),
    );
  });

  it('declares a payment and maps an unclassified excess to 422', async () => {
    record.execute.mockRejectedValue(new LoanPaymentExcessUnclassifiedError());

    const response = await application.inject({
      headers: { authorization, 'idempotency-key': key },
      method: 'POST',
      payload: { amount: '60.00', kind: 'payment', occurredOn: '2026-02-10' },
      url: `/api/v1/loans/${loanId}/events`,
    });

    expect(response.statusCode).toBe(422);
    expect(record.execute).toHaveBeenCalledWith({
      actorId,
      event: { amount: '60.00', kind: 'payment', occurredOn: '2026-02-10' },
      idempotencyKey: key,
      loanId,
    });
  });

  it.each([
    ['unknown event kind', { kind: 'withdrawal', amount: '1.00' }],
    ['reversal without reason', { kind: 'reversal', reversedEventId: loanId }],
    [
      'negative amount',
      { amount: '-1.00', kind: 'payment', occurredOn: '2026-02-10' },
    ],
    [
      'invalid excess',
      {
        amount: '1.00',
        excess: 'gift',
        kind: 'payment',
        occurredOn: '2026-02-10',
      },
    ],
  ])('rejects %s before the use case', async (_label, payload) => {
    const response = await application.inject({
      headers: { authorization, 'idempotency-key': key },
      method: 'POST',
      payload,
      url: `/api/v1/loans/${loanId}/events`,
    });

    expect(response.statusCode).toBe(400);
    expect(record.execute).not.toHaveBeenCalled();
  });

  it('requires an idempotency key for writes', async () => {
    const response = await application.inject({
      headers: { authorization },
      method: 'POST',
      payload: { ...terms, direction: 'payable' },
      url: '/api/v1/loans',
    });

    expect(response.statusCode).toBe(400);
    expect(create.execute).not.toHaveBeenCalled();
  });

  it('does not reveal another holder loan', async () => {
    get.execute.mockRejectedValue(new LoanNotFoundError());

    const response = await application.inject({
      headers: { authorization },
      method: 'GET',
      url: `/api/v1/loans/${loanId}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects anonymous calls', async () => {
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/loans',
    });

    expect(response.statusCode).toBe(401);
  });
});
