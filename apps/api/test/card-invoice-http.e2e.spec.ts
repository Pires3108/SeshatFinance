import {
  CardInvoiceNotFoundError,
  CloseCardInvoiceUseCase,
  GetCardInvoiceUseCase,
  ListCardInvoicesUseCase,
  ResolveAuthenticatedActorUseCase,
  type CardInvoiceView,
} from '@seshat/application';
import {
  CardCycleSchedule,
  CardInvoice,
  CivilDate,
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

const cardId = '7943309c-9c98-41d4-aa61-4811b12633f5';
const actorId = 'actor-b';
const authorization = 'Bearer actor-b-token';
const brl = Currency.create('BRL', 2);

function view(): CardInvoiceView {
  const invoice = CardInvoice.form({
    cardId,
    closingBoundary: 'next-cycle',
    createdAt: new Date('2026-10-20T15:00:00.000Z'),
    currency: brl,
    cycle: CardCycleSchedule.create({
      closingBoundary: 'next-cycle',
      closingDay: 28,
      dueDay: 7,
    }).cycleFor(CivilDate.parse('2026-10-20'), () => false),
    holidayDatasetVersion: 'v1',
    id: '0f6b0d3e-6a40-4a4f-9b5d-6f3e3f2a1b0c',
    ownerId: actorId,
    timeZone: 'America/Sao_Paulo',
  }).close(Money.fromDecimal('130.35', brl), new Date('2026-10-29T12:00:00Z'));
  return {
    invoice,
    purchaseCount: 2,
    purchasesTotal: Money.fromDecimal('130.35', brl),
    settledTotal: Money.fromDecimal('0', brl),
  };
}

describe('Card invoice HTTP boundary', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const list = { execute: vi.fn<ListCardInvoicesUseCase['execute']>() };
  const get = { execute: vi.fn<GetCardInvoiceUseCase['execute']>() };
  const close = { execute: vi.fn<CloseCardInvoiceUseCase['execute']>() };

  beforeEach(async (): Promise<void> => {
    for (const mock of [list, get, close]) mock.execute.mockReset();
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(ListCardInvoicesUseCase)
      .useValue(list)
      .overrideProvider(GetCardInvoiceUseCase)
      .useValue(get)
      .overrideProvider(CloseCardInvoiceUseCase)
      .useValue(close)
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

  it('lists invoices with frozen dates and reconciled totals', async () => {
    list.execute.mockResolvedValue([view()]);

    const response = await application.inject({
      headers: { authorization },
      method: 'GET',
      url: `/api/v1/credit-cards/${cardId}/invoices`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        closedTotal: '130.35',
        closesOn: '2026-10-28',
        dueOn: '2026-11-09',
        purchasesTotal: '130.35',
        remaining: '130.35',
        status: 'closed',
      }),
    ]);
    expect(list.execute).toHaveBeenCalledWith({ actorId, cardId });
  });

  it('closes for the verified actor and returns 200 on repetition', async () => {
    close.execute.mockResolvedValue(view());
    const request = {
      headers: { authorization },
      method: 'POST' as const,
      url: `/api/v1/credit-cards/${cardId}/invoices/2026-10-28/close`,
    };

    const first = await application.inject(request);
    const second = await application.inject(request);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(close.execute).toHaveBeenCalledWith({
      actorId,
      cardId,
      closesOn: '2026-10-28',
    });
  });

  it('does not reveal another holder invoice', async () => {
    get.execute.mockRejectedValue(new CardInvoiceNotFoundError());

    const response = await application.inject({
      headers: { authorization },
      method: 'GET',
      url: `/api/v1/credit-cards/${cardId}/invoices/2026-10-28`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('rejects an invalid closing date before the use case', async () => {
    const response = await application.inject({
      headers: { authorization },
      method: 'POST',
      url: `/api/v1/credit-cards/${cardId}/invoices/2026-02-30x/close`,
    });

    expect(response.statusCode).toBe(400);
    expect(close.execute).not.toHaveBeenCalled();
  });
});
