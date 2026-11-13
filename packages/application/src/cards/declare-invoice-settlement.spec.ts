import {
  Account,
  AccountType,
  CreditCard,
  Currency,
  Money,
  type FinancialAuditEvent,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import type { AccountRepository } from '../accounts/create-account.js';
import {
  IdempotencyConflictError,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { CreditCardRepository } from './create-credit-card.js';
import {
  DeclareInvoiceSettlementUseCase,
  InvoiceSettlementAccountUnavailableError,
  InvoiceSettlementCurrencyMismatchError,
  InvoiceSettlementExceedsRemainingError,
  type InvoiceSettlementRepository,
  type InvoiceSettlementWrite,
} from './declare-invoice-settlement.js';
import { CardInvoiceNotFoundError } from './manage-card-invoice.js';
import { CreditCardNotFoundError } from './manage-credit-card.js';

const ownerId = 'owner-id';
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

function account(id: string, currency = brl): Account {
  return Account.create({
    color: null,
    createdAt: new Date('2026-09-22T17:00:00.000Z'),
    description: null,
    icon: null,
    id,
    initialBalance: Money.fromDecimal('1000.00', currency),
    institution: null,
    name: 'Conta',
    ownerId,
    type: AccountType.create('checking-account'),
  });
}
const accountsById = new Map([
  ['account-id', account('account-id')],
  ['usd-account', account('usd-account', Currency.create('USD', 2))],
]);
const accounts: AccountRepository = {
  findByIdForOwner: (id, actor) =>
    Promise.resolve(actor === ownerId ? (accountsById.get(id) ?? null) : null),
  insert: () => Promise.resolve(),
  listForOwner: () => Promise.resolve([...accountsById.values()]),
  save: () => Promise.resolve(true),
};

/** Remaining obligation 130.35 on the invoice closing 2026-10-28. */
function settlements(): InvoiceSettlementRepository & {
  writes: InvoiceSettlementWrite[];
} {
  const records = new Map<string, { hash: string; response: string }>();
  const writes: InvoiceSettlementWrite[] = [];
  let remaining = 13035n;
  const find = (request: IdempotencyRequest): string | null => {
    const record = records.get(request.key);
    if (record === undefined) return null;
    if (record.hash !== JSON.stringify(request.payload))
      throw new IdempotencyConflictError();
    return record.response;
  };
  return {
    findIdempotentResponse: (request) => Promise.resolve(find(request)),
    settleAtomically: (request, _card, closesOn, write) => {
      const replay = find(request);
      if (replay !== null) return Promise.resolve(replay);
      if (closesOn !== '2026-10-28') return Promise.resolve(null);
      const amount = write.settlement.amount.toMinorUnits();
      if (amount > remaining)
        return Promise.reject(new InvoiceSettlementExceedsRemainingError());
      remaining -= amount;
      writes.push(write);
      records.set(request.key, {
        hash: JSON.stringify(request.payload),
        response: write.response,
      });
      return Promise.resolve(write.response);
    },
    writes,
  };
}

function useCase(
  repository: InvoiceSettlementRepository,
): DeclareInvoiceSettlementUseCase {
  let next = 0;
  return new DeclareInvoiceSettlementUseCase(
    cards,
    accounts,
    repository,
    { now: () => new Date('2026-11-05T12:00:00.000Z') },
    { generate: () => `id-${String((next += 1))}` },
  );
}

const command = {
  accountId: 'account-id',
  actorId: ownerId,
  amount: '100.00',
  cardId: card.id,
  currencyCode: 'BRL',
  currencyMinorUnitScale: 2,
  idempotencyKey: '6f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f',
  invoiceClosesOn: '2026-10-28',
  paidAt: new Date('2026-11-05T10:00:00.000Z'),
} as const;

describe('DeclareInvoiceSettlementUseCase', () => {
  it('writes one account movement, the settlement and two audit events', async () => {
    const repository = settlements();

    const settlement = await useCase(repository).execute(command);

    expect(settlement.amount.toDecimal()).toBe('100.00');
    const write = repository.writes[0];
    expect(write?.transaction.toSnapshot()).toMatchObject({
      accountId: 'account-id',
      amount: { amount: '100.00' },
      kind: 'expense',
    });
    expect(write?.settlement.toSnapshot().transactionId).toBe(
      write?.transaction.id,
    );
    expect(
      write?.auditEvents.map(
        (event: FinancialAuditEvent) => event.toSnapshot().resourceType,
      ),
    ).toEqual(['transaction', 'invoice-settlement']);
  });

  it('keeps the remaining debt after a partial payment and rejects the excess', async () => {
    const repository = settlements();
    await useCase(repository).execute(command);

    await expect(
      useCase(repository).execute({
        ...command,
        amount: '30.36',
        idempotencyKey: '7f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f',
      }),
    ).rejects.toThrow(InvoiceSettlementExceedsRemainingError);
    await useCase(repository).execute({
      ...command,
      amount: '30.35',
      idempotencyKey: '8f1c2f5e-8a4b-4c1d-9e2f-3a4b5c6d7e8f',
    });
    expect(repository.writes).toHaveLength(2);
  });

  it('replays the same key without a new effect', async () => {
    const repository = settlements();
    const first = await useCase(repository).execute(command);
    const second = await useCase(repository).execute(command);

    expect(second.toSnapshot()).toEqual(first.toSnapshot());
    expect(repository.writes).toHaveLength(1);
  });

  it.each([
    ['another holder card', { actorId: 'intruder' }, CreditCardNotFoundError],
    [
      'a foreign or missing account',
      { accountId: 'missing' },
      InvoiceSettlementAccountUnavailableError,
    ],
    [
      'an account in another currency',
      { accountId: 'usd-account' },
      InvoiceSettlementCurrencyMismatchError,
    ],
    [
      'a missing invoice',
      { invoiceClosesOn: '2026-09-28' },
      CardInvoiceNotFoundError,
    ],
  ])('rejects %s without writing', async (_label, change, error) => {
    const repository = settlements();

    await expect(
      useCase(repository).execute({ ...command, ...change }),
    ).rejects.toThrow(error);
    expect(repository.writes).toHaveLength(0);
  });
});
