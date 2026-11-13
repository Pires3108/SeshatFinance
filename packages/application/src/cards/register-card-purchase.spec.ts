import {
  Category,
  CreditCard,
  Currency,
  Money,
  type CardPurchase,
  type FinancialAuditEvent,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import { EMPTY_HOLIDAY_SETTINGS } from '../calendar/holiday-settings.js';
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { CreditCardRepository } from './create-credit-card.js';
import {
  CardCycleResolver,
  CreditCardNotFoundError,
} from './manage-credit-card.js';
import {
  CardPurchaseCategoryUnavailableError,
  CardPurchaseCurrencyMismatchError,
  RegisterCardPurchaseUseCase,
  type CardPurchaseRepository,
} from './register-card-purchase.js';

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

const cards: CreditCardRepository = {
  findByIdForOwner: (id, actor) =>
    Promise.resolve(id === card.id && actor === ownerId ? card : null),
  insert: () => Promise.resolve(),
  listForOwner: () => Promise.resolve([card]),
  update: () => Promise.resolve(true),
};

function purchases(): CardPurchaseRepository & {
  inserted: { purchase: CardPurchase; event: FinancialAuditEvent }[];
} {
  const records = new Map<string, { hash: string; response: string }>();
  const inserted: { purchase: CardPurchase; event: FinancialAuditEvent }[] = [];
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
    insertAtomically: (purchase, event, idempotency) => {
      const replay = find(idempotency.request);
      if (replay !== null) return Promise.resolve(replay);
      inserted.push({ event, purchase });
      records.set(`${idempotency.request.ownerId}:${idempotency.request.key}`, {
        hash: hash(idempotency.request),
        response: idempotency.response,
      });
      return Promise.resolve(idempotency.response);
    },
    inserted,
    listForCard: () => Promise.resolve(inserted.map((item) => item.purchase)),
  };
}

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

const category = Category.create({
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  id: 'category-id',
  name: 'Mercado',
  ownerId,
  parentCategoryId: null,
});

function useCase(
  repository: CardPurchaseRepository,
): RegisterCardPurchaseUseCase {
  let next = 0;
  return new RegisterCardPurchaseUseCase(
    cards,
    repository,
    {
      findByIdForOwner: (id, actor) =>
        Promise.resolve(
          id === category.id && actor === ownerId ? category : null,
        ),
    },
    resolver,
    { now: () => new Date('2026-10-28T10:00:00.000Z') },
    { generate: () => `id-${String((next += 1))}` },
  );
}

const command = {
  actorId: ownerId,
  amount: '120.35',
  cardId: card.id,
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  description: 'Mercado',
  idempotencyKey: key,
  // 27/10 21:30 in São Paulo: the day before the closing date.
  occurredAt: new Date('2026-10-28T00:30:00.000Z'),
} as const;

describe('RegisterCardPurchaseUseCase', () => {
  it('records one purchase in the cycle of its civil date with one audit event', async () => {
    const repository = purchases();

    const purchase = await useCase(repository).execute(command);

    expect(purchase.toSnapshot()).toMatchObject({
      amount: { amount: '120.35' },
      cycleClosesOn: '2026-10-28',
    });
    expect(repository.inserted).toHaveLength(1);
    expect(repository.inserted[0]?.event.toSnapshot()).toMatchObject({
      action: 'created',
      resourceType: 'card-purchase',
    });
  });

  it('sends a purchase on the closing date to the next cycle', async () => {
    const purchase = await useCase(purchases()).execute({
      ...command,
      occurredAt: new Date('2026-10-28T15:00:00.000Z'),
    });

    expect(purchase.toSnapshot().cycleClosesOn).toBe('2026-11-28');
  });

  it('replays an identical retry without a second write', async () => {
    const repository = purchases();
    const first = await useCase(repository).execute(command);
    const second = await useCase(repository).execute(command);

    expect(second.toSnapshot()).toEqual(first.toSnapshot());
    expect(repository.inserted).toHaveLength(1);
  });

  it('rejects the same key with a different payload without writing', async () => {
    const repository = purchases();
    await useCase(repository).execute(command);

    await expect(
      useCase(repository).execute({ ...command, amount: '99.00' }),
    ).rejects.toThrow(IdempotencyConflictError);
    expect(repository.inserted).toHaveLength(1);
  });

  it.each([
    ['another holder card', { actorId: 'intruder' }, CreditCardNotFoundError],
    [
      'a different currency',
      { currencyCode: 'USD' },
      CardPurchaseCurrencyMismatchError,
    ],
    [
      'a foreign category',
      { categoryId: 'other-category' },
      CardPurchaseCategoryUnavailableError,
    ],
    ['an invalid key', { idempotencyKey: 'abc' }, InvalidIdempotencyKeyError],
  ])('rejects %s without writing', async (_label, change, error) => {
    const repository = purchases();

    await expect(
      useCase(repository).execute({ ...command, ...change }),
    ).rejects.toThrow(error);
    expect(repository.inserted).toHaveLength(0);
  });
});
