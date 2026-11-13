import {
  ChangeOwnedTransactionLifecycleUseCase,
  CreditCardNotFoundError,
  DeclareInvoiceSettlementUseCase,
  IdempotencyConflictError,
  InvoiceSettlementExceedsRemainingError,
  ResolveAuthenticatedActorUseCase,
  TransactionRequiresCardSettlementMutationError,
} from '@seshat/application';
import { CivilDate, Currency, InvoiceSettlement, Money } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const cardId = '7943309c-9c98-41d4-aa61-4811b12633f5';
const accountId = '11111111-1111-4111-8111-111111111111';
const actorId = 'actor-b';
const key = '6f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f';
const url = `/api/v1/credit-cards/${cardId}/invoices/2026-10-28/settlements`;
const payload = {
  accountId,
  amount: '100.00',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  paidAt: '2026-11-05T10:00:00.000Z',
};

describe('Invoice settlement HTTP boundary', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const declare = {
    execute: vi.fn<DeclareInvoiceSettlementUseCase['execute']>(),
  };
  const lifecycle = {
    execute: vi
      .fn<ChangeOwnedTransactionLifecycleUseCase['execute']>()
      .mockRejectedValue(
        new TransactionRequiresCardSettlementMutationError('settlement-id'),
      ),
  };

  beforeEach(async (): Promise<void> => {
    declare.execute.mockReset();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(DeclareInvoiceSettlementUseCase)
      .useValue(declare)
      .overrideProvider(ChangeOwnedTransactionLifecycleUseCase)
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

  it('records a declared payment for the verified actor', async () => {
    declare.execute.mockResolvedValue(
      InvoiceSettlement.create({
        accountId,
        amount: Money.fromDecimal('100.00', Currency.create('BRL', 2)),
        cardId,
        createdAt: new Date('2026-11-05T12:00:00.000Z'),
        id: '0f6b0d3e-6a40-4a4f-9b5d-6f3e3f2a1b0c',
        invoiceClosesOn: CivilDate.parse('2026-10-28'),
        ownerId: actorId,
        paidAt: new Date('2026-11-05T10:00:00.000Z'),
        transactionId: '1f6b0d3e-6a40-4a4f-9b5d-6f3e3f2a1b0c',
      }),
    );

    const response = await application.inject({
      headers: { authorization: 'Bearer token', 'idempotency-key': key },
      method: 'POST',
      payload,
      url,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      amount: '100.00',
      invoiceClosesOn: '2026-10-28',
    });
    expect(response.json()).not.toHaveProperty('ownerId');
    expect(declare.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        cardId,
        idempotencyKey: key,
        invoiceClosesOn: '2026-10-28',
      }),
    );
  });

  it('requires an idempotency key', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer token' },
      method: 'POST',
      payload,
      url,
    });

    expect(response.statusCode).toBe(400);
    expect(declare.execute).not.toHaveBeenCalled();
  });

  it.each([
    [new CreditCardNotFoundError(), 404],
    [new InvoiceSettlementExceedsRemainingError(), 422],
    [new IdempotencyConflictError(), 409],
  ])('maps %s to %i', async (error, status) => {
    declare.execute.mockRejectedValue(error);

    const response = await application.inject({
      headers: { authorization: 'Bearer token', 'idempotency-key': key },
      method: 'POST',
      payload,
      url,
    });

    expect(response.statusCode).toBe(status);
  });

  it('refuses to trash a settlement movement through the transactions endpoint', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer token' },
      method: 'PATCH',
      payload: { action: 'move-to-trash' },
      url: '/api/v1/transactions/1f6b0d3e-6a40-4a4f-9b5d-6f3e3f2a1b0c/lifecycle',
    });

    expect(response.statusCode).toBe(409);
  });
});
