import { CardPurchase, CreditCard, Currency, Money } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { CreditCardRepository } from './create-credit-card.js';
import {
  CardPurchaseCurrencyMismatchError,
  OwnedCreditCardNotFoundError,
  RegisterCardPurchaseUseCase,
  type CardPurchaseRepository,
} from './register-card-purchase.js';

const card = CreditCard.create({
  brand: 'Visa',
  closingDay: 28,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  dueDay: 7,
  id: 'card-id',
  limit: Money.fromDecimal('1000', Currency.create('BRL', 2)),
  name: 'Principal',
  ownerId: 'owner-id',
  paymentAccountId: 'account-id',
});

const command = {
  actorId: 'owner-id',
  amount: '10.50',
  cardId: 'card-id',
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  description: 'Compra',
  idempotencyKey: 'request-id',
  occurredAt: new Date('2026-10-04T12:00:00Z'),
} as const;

function cards(owned: boolean): CreditCardRepository {
  return {
    findByIdForOwner: () => Promise.resolve(owned ? card : null),
    insert: () => Promise.resolve(),
    listForOwner: () => Promise.resolve([]),
  };
}

describe('RegisterCardPurchaseUseCase', () => {
  it('passes one purchase and audit event to an atomic idempotent port', async () => {
    let registered: CardPurchase | undefined;
    let fingerprint = '';
    const purchases: CardPurchaseRepository = {
      register: (purchase, key, hash, audit) => {
        registered = purchase;
        fingerprint = hash;
        expect(key).toBe('request-id');
        expect(audit.toSnapshot()).toMatchObject({
          resourceType: 'card-purchase',
          resourceId: purchase.id,
        });
        return Promise.resolve({ purchase, replayed: false });
      },
    };
    const useCase = new RegisterCardPurchaseUseCase(
      cards(true),
      purchases,
      { now: () => new Date('2026-10-05T12:00:00Z') },
      { generate: () => 'generated-id' },
    );
    const result = await useCase.execute(command);
    expect(result.purchase).toBe(registered);
    expect(result.purchase.amount.toDecimal()).toBe('10.50');
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects a card outside the actor ownership', async () => {
    const useCase = new RegisterCardPurchaseUseCase(
      cards(false),
      {
        register: () => {
          throw new Error('unexpected write');
        },
      },
      { now: () => new Date() },
      { generate: () => 'id' },
    );
    await expect(useCase.execute(command)).rejects.toThrow(
      OwnedCreditCardNotFoundError,
    );
  });

  it('rejects a mismatched currency', async () => {
    const useCase = new RegisterCardPurchaseUseCase(
      cards(true),
      {
        register: () => {
          throw new Error('unexpected write');
        },
      },
      { now: () => new Date() },
      { generate: () => 'id' },
    );
    await expect(
      useCase.execute({ ...command, currencyCode: 'USD' }),
    ).rejects.toThrow(CardPurchaseCurrencyMismatchError);
  });
});
