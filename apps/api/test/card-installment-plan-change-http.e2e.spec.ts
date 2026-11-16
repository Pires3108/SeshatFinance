import {
  GetCardInstallmentPlanChainUseCase,
  PrepayCardInstallmentPlanUseCase,
  RenegotiateCardInstallmentPlanUseCase,
  ResolveAuthenticatedActorUseCase,
  ReverseCardInstallmentPlanChangeUseCase,
} from '@seshat/application';
import { CardPlanPrepaymentMismatchError } from '@seshat/domain';
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
const changeId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const key = '6f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f';
const actorId = 'actor-b';
const base = `/api/v1/credit-cards/${cardId}/purchases/${purchaseId}/installment-plan`;
const headers = {
  authorization: 'Bearer actor-b-token',
  'idempotency-key': key,
};

describe('Card installment plan change HTTP boundary (US-046)', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const chain = {
    execute: vi.fn<GetCardInstallmentPlanChainUseCase['execute']>(),
  };
  const prepay = {
    execute: vi.fn<PrepayCardInstallmentPlanUseCase['execute']>(),
  };
  const renegotiate = {
    execute: vi.fn<RenegotiateCardInstallmentPlanUseCase['execute']>(),
  };
  const reverse = {
    execute: vi.fn<ReverseCardInstallmentPlanChangeUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    for (const mock of [chain, prepay, renegotiate, reverse]) {
      mock.execute.mockReset();
    }
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(GetCardInstallmentPlanChainUseCase)
      .useValue(chain)
      .overrideProvider(PrepayCardInstallmentPlanUseCase)
      .useValue(prepay)
      .overrideProvider(RenegotiateCardInstallmentPlanUseCase)
      .useValue(renegotiate)
      .overrideProvider(ReverseCardInstallmentPlanChangeUseCase)
      .useValue(reverse)
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

  it('forwards a prepayment for the verified actor and maps a mismatch to 422', async () => {
    prepay.execute.mockRejectedValue(new CardPlanPrepaymentMismatchError());

    const response = await application.inject({
      headers,
      method: 'POST',
      payload: { amount: '60.00', discount: '0.00' },
      url: `${base}/prepayment`,
    });

    expect(response.statusCode).toBe(422);
    expect(prepay.execute).toHaveBeenCalledWith({
      actorId,
      amount: '60.00',
      cardId,
      discount: '0.00',
      idempotencyKey: key,
      purchaseId,
    });
  });

  it('forwards a renegotiation and a reversal with their parameters', async () => {
    const empty = { plans: [], referenceCycleClosesOn: '2026-11-28' };
    renegotiate.execute.mockResolvedValue(empty);
    reverse.execute.mockResolvedValue(empty);

    const renegotiation = await application.inject({
      headers,
      method: 'POST',
      payload: { count: 4, principal: '66.67', rate: null },
      url: `${base}/renegotiation`,
    });
    const reversal = await application.inject({
      headers,
      method: 'POST',
      payload: { reason: 'Lançada por engano' },
      url: `${base}/changes/${changeId}/reversal`,
    });

    expect(renegotiation.statusCode).toBe(200);
    expect(reversal.statusCode).toBe(200);
    expect(renegotiate.execute).toHaveBeenCalledWith(
      expect.objectContaining({ count: 4, principal: '66.67', rate: null }),
    );
    expect(reverse.execute).toHaveBeenCalledWith(
      expect.objectContaining({ changeId, reason: 'Lançada por engano' }),
    );
  });

  it.each([
    ['prepayment', { amount: '-1', discount: '0' }],
    ['renegotiation', { count: 0, principal: '10.00' }],
    [`changes/${changeId}/reversal`, { reason: ' ' }],
  ])('rejects an invalid %s before the use case', async (path, payload) => {
    const response = await application.inject({
      headers,
      method: 'POST',
      payload,
      url: `${base}/${path}`,
    });

    expect(response.statusCode).toBe(400);
    expect(prepay.execute).not.toHaveBeenCalled();
    expect(renegotiate.execute).not.toHaveBeenCalled();
    expect(reverse.execute).not.toHaveBeenCalled();
  });

  it('rejects anonymous calls', async () => {
    const response = await application.inject({
      method: 'GET',
      url: `${base}/chain`,
    });

    expect(response.statusCode).toBe(401);
  });
});
