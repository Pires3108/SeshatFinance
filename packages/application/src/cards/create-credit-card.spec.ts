import {
  Account,
  AccountType,
  Currency,
  type FinancialAuditEvent,
  Money,
  type CreditCard,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { AccountRepository } from '../accounts/create-account.js';
import {
  CreateCreditCardUseCase,
  CreditCardCurrencyMismatchError,
  CreditCardPaymentAccountUnavailableError,
  type CreditCardRepository,
} from './create-credit-card.js';

const ownerId = 'owner-id';
const accountId = 'account-id';

function account(currency = Currency.create('BRL', 2)): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-22T17:00:00.000Z'),
    description: null,
    icon: null,
    id: accountId,
    initialBalance: Money.fromDecimal('0', currency),
    institution: null,
    name: 'Conta de pagamento',
    ownerId,
    type: AccountType.create('checking-account'),
  });
}

function accounts(value: Account | null): AccountRepository {
  return {
    findByIdForOwner: (id, actorId) =>
      Promise.resolve(
        value !== null && value.id === id && value.ownerId === actorId
          ? value
          : null,
      ),
    insert: () => Promise.resolve(),
    listForOwner: () => Promise.resolve(value === null ? [] : [value]),
    save: () => Promise.resolve(true),
  };
}

const command = {
  actorId: ownerId,
  brand: 'Visa',
  closingDay: 28,
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  dueDay: 7,
  limit: '3500.00',
  name: 'Cartão principal',
  paymentAccountId: accountId,
} as const;

describe('CreateCreditCardUseCase', () => {
  it('links an owned active account and writes one audit event', async () => {
    let inserted: CreditCard | undefined;
    let auditEvent: FinancialAuditEvent | undefined;
    const cards: CreditCardRepository = {
      insert: (card, event) => {
        inserted = card;
        auditEvent = event;
        return Promise.resolve();
      },
      findByIdForOwner: () => Promise.resolve(null),
      listForOwner: () => Promise.resolve([]),
    };
    const identifiers = ['card-id', 'audit-id'];
    const useCase = new CreateCreditCardUseCase(
      accounts(account()),
      cards,
      { now: () => new Date('2026-09-22T18:00:00.000Z') },
      { generate: () => identifiers.shift() ?? 'unexpected-id' },
    );

    const created = await useCase.execute(command);

    expect(inserted).toBe(created);
    expect(created.toSnapshot()).toMatchObject({
      id: 'card-id',
      limit: { amount: '3500.00' },
      ownerId,
      paymentAccountId: accountId,
    });
    expect(auditEvent?.toSnapshot()).toMatchObject({
      id: 'audit-id',
      resourceId: 'card-id',
      resourceType: 'credit-card',
    });
  });

  it('rejects a missing or foreign payment account', async () => {
    const useCase = new CreateCreditCardUseCase(
      accounts(null),
      {
        insert: () => Promise.resolve(),
        findByIdForOwner: () => Promise.resolve(null),
        listForOwner: () => Promise.resolve([]),
      },
      { now: () => new Date() },
      { generate: () => 'id' },
    );

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(
      CreditCardPaymentAccountUnavailableError,
    );
  });

  it('rejects a limit in a different currency', async () => {
    const useCase = new CreateCreditCardUseCase(
      accounts(account(Currency.create('USD', 2))),
      {
        insert: () => Promise.resolve(),
        findByIdForOwner: () => Promise.resolve(null),
        listForOwner: () => Promise.resolve([]),
      },
      { now: () => new Date() },
      { generate: () => 'id' },
    );

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(
      CreditCardCurrencyMismatchError,
    );
  });
});
