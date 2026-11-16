import {
  CardPurchase,
  CivilDate,
  CreditCard,
  Currency,
  InvalidInstallmentPlanError,
  InvalidInterestRateError,
  Money,
  type CardInstallmentPlan,
  type CardInvoice,
  type FinancialAuditEvent,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import { EMPTY_HOLIDAY_SETTINGS } from '../calendar/holiday-settings.js';
import {
  IdempotencyConflictError,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { CreditCardRepository } from './create-credit-card.js';
import {
  CardCycleResolver,
  CreditCardNotFoundError,
} from './manage-credit-card.js';
import {
  CardInstallmentInvoiceClosedError,
  CardPurchaseAlreadyInstalledError,
  CardPurchaseNotFoundError,
  GetCardInstallmentPlanUseCase,
  PreviewCardInstallmentPlanUseCase,
  RegisterCardInstallmentPlanUseCase,
  type CardInstallmentPlanRepository,
} from './register-card-installment-plan.js';

const ownerId = 'owner-id';
const key = '6f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f';
const brl = Currency.create('BRL', 2);
const card = CreditCard.create({
  brand: 'Visa',
  closingDay: 28,
  createdAt: new Date('2026-09-22T18:00:00.000Z'),
  dueDay: 7,
  id: 'card-id',
  limit: Money.fromDecimal('3500.00', brl),
  name: 'Cartão',
  ownerId,
  paymentAccountId: 'account-id',
});
const purchase = CardPurchase.create({
  amount: Money.fromDecimal('100.00', brl),
  cardId: card.id,
  createdAt: new Date('2026-11-10T12:00:00.000Z'),
  cycleClosesOn: CivilDate.parse('2026-11-28'),
  description: 'Geladeira',
  id: 'purchase-id',
  // 10/11 in São Paulo: cycle closing on 28/11.
  occurredAt: new Date('2026-11-10T12:00:00.000Z'),
  ownerId,
});

const cards: CreditCardRepository = {
  findByIdForOwner: (id, actor) =>
    Promise.resolve(id === card.id && actor === ownerId ? card : null),
  insert: () => Promise.resolve(),
  listForOwner: () => Promise.resolve([card]),
  update: () => Promise.resolve(true),
};

const resolver = new CardCycleResolver(
  {
    changeTimeZone: () => Promise.resolve(null),
    findById: () => Promise.resolve(null),
    upsert: (profile) => Promise.resolve(profile),
  },
  {
    addDeclared: () => Promise.resolve(),
    findForOwner: () => Promise.resolve(EMPTY_HOLIDAY_SETTINGS),
    removeDeclared: () => Promise.resolve(false),
    saveLocation: () => Promise.resolve(),
  },
);

type FakeRepository = CardInstallmentPlanRepository & {
  inserted: {
    plan: CardInstallmentPlan;
    event: FinancialAuditEvent;
    invoices: readonly CardInvoice[];
  }[];
};

function plans(closed: readonly string[] = []): FakeRepository {
  const records = new Map<string, { hash: string; response: string }>();
  const inserted: FakeRepository['inserted'] = [];
  const hash = (request: IdempotencyRequest): string =>
    JSON.stringify(request.payload);
  const find = (request: IdempotencyRequest): string | null => {
    const record = records.get(`${request.ownerId}:${request.key}`);
    if (record === undefined) return null;
    if (record.hash !== hash(request)) throw new IdempotencyConflictError();
    return record.response;
  };
  return {
    findIdempotentResponse: (request) => Promise.resolve(find(request)),
    findPlanForPurchase: (id, actor) =>
      Promise.resolve(
        inserted.find(
          (item) => item.plan.purchaseId === id && item.plan.ownerId === actor,
        )?.plan ?? null,
      ),
    findPurchaseForOwner: (id, actor) =>
      Promise.resolve(
        id === purchase.id && actor === ownerId ? purchase : null,
      ),
    insertAtomically: (request, invoices, write) => {
      const replay = find(request);
      if (replay !== null) return Promise.resolve(replay);
      if (
        invoices.some((invoice) => closed.includes(invoice.closesOn.toString()))
      ) {
        return Promise.reject(new CardInstallmentInvoiceClosedError());
      }
      inserted.push({ event: write.auditEvent, invoices, plan: write.plan });
      records.set(`${request.ownerId}:${request.key}`, {
        hash: hash(request),
        response: write.response,
      });
      return Promise.resolve(write.response);
    },
    inserted,
  };
}

function register(
  repository: CardInstallmentPlanRepository,
): RegisterCardInstallmentPlanUseCase {
  let next = 0;
  return new RegisterCardInstallmentPlanUseCase(
    cards,
    repository,
    resolver,
    { now: () => new Date('2026-11-16T12:00:00.000Z') },
    { generate: () => `id-${String((next += 1))}` },
  );
}

const command = {
  actorId: ownerId,
  cardId: card.id,
  count: 3,
  idempotencyKey: key,
  purchaseId: purchase.id,
  rate: null,
} as const;

describe('PreviewCardInstallmentPlanUseCase (RN-021)', () => {
  it('shows principal, interest, total and the cycle of each installment', async () => {
    const preview = await new PreviewCardInstallmentPlanUseCase(
      cards,
      plans(),
      resolver,
    ).execute({
      ...command,
      count: 2,
      rate: { method: 'simple', percentPerPeriod: '1', periodicity: 'monthly' },
    });

    expect(preview.plan.interest.toDecimal()).toBe('2.00');
    expect(preview.plan.total.toDecimal()).toBe('102.00');
    expect(preview.cycles.map((cycle) => cycle.closesOn.toString())).toEqual([
      '2026-11-28',
      '2026-12-28',
    ]);
    expect(preview.cycles.map((cycle) => cycle.dueOn.toString())).toEqual([
      '2026-12-07',
      '2027-01-07',
    ]);
  });
});

describe('RegisterCardInstallmentPlanUseCase (US-044)', () => {
  it('assigns one installment per consecutive cycle from the purchase cycle', async () => {
    const repository = plans();
    const plan = await register(repository).execute(command);
    const snapshot = plan.toSnapshot();

    expect(snapshot.installments.map((item) => item.amount.amount)).toEqual([
      '33.33',
      '33.33',
      '33.34',
    ]);
    expect(snapshot.installments.map((item) => item.cycleClosesOn)).toEqual([
      '2026-11-28',
      '2026-12-28',
      '2027-01-28',
    ]);
    expect(
      repository.inserted[0]?.invoices.map((invoice) =>
        invoice.closesOn.toString(),
      ),
    ).toEqual(['2026-11-28', '2026-12-28', '2027-01-28']);
    expect(repository.inserted[0]?.event.toSnapshot()).toMatchObject({
      action: 'created',
      resourceId: plan.id,
      resourceType: 'card-installment-plan',
    });
  });

  it('returns the original schedule when the confirmation is repeated', async () => {
    const repository = plans();
    const first = await register(repository).execute(command);
    const second = await register(repository).execute(command);

    expect(second.toSnapshot()).toEqual(first.toSnapshot());
    expect(repository.inserted).toHaveLength(1);
  });

  it('rejects the same key with different parameters', async () => {
    const repository = plans();
    await register(repository).execute(command);

    await expect(
      register(repository).execute({ ...command, count: 4 }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it('rejects a second plan for the same purchase', async () => {
    const repository = plans();
    await register(repository).execute(command);

    await expect(
      register(repository).execute({
        ...command,
        idempotencyKey: '7f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f',
      }),
    ).rejects.toThrow(CardPurchaseAlreadyInstalledError);
  });

  it('rejects when a target invoice is already closed', async () => {
    const repository = plans(['2026-12-28']);

    await expect(register(repository).execute(command)).rejects.toThrow(
      CardInstallmentInvoiceClosedError,
    );
    expect(repository.inserted).toHaveLength(0);
  });

  it.each([
    ['zero installments', { count: 0 }, InvalidInstallmentPlanError],
    [
      'rate without periodicity',
      { rate: { method: 'simple', percentPerPeriod: '1', periodicity: '' } },
      InvalidInterestRateError,
    ],
    ['unknown card', { cardId: 'other-card' }, CreditCardNotFoundError],
    ['unknown purchase', { purchaseId: 'other' }, CardPurchaseNotFoundError],
    ['another owner', { actorId: 'intruder' }, CreditCardNotFoundError],
  ])('rejects %s without writing', async (_label, change, error) => {
    const repository = plans();

    await expect(
      register(repository).execute({ ...command, ...change }),
    ).rejects.toThrow(error);
    expect(repository.inserted).toHaveLength(0);
  });
});

describe('GetCardInstallmentPlanUseCase', () => {
  it('returns the plan of a purchase or null when it has none', async () => {
    const repository = plans();
    const get = new GetCardInstallmentPlanUseCase(cards, repository);
    const query = {
      actorId: ownerId,
      cardId: card.id,
      purchaseId: purchase.id,
    };

    expect(await get.execute(query)).toBeNull();
    const plan = await register(repository).execute(command);
    expect((await get.execute(query))?.id).toBe(plan.id);
  });
});
