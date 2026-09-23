import {
  CreditCard,
  Currency,
  FinancialAuditEvent,
  Money,
} from '@seshat/domain';

import type { AccountRepository } from '../accounts/create-account.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export type CreateCreditCardCommand = Readonly<{
  actorId: string;
  brand: string;
  closingDay: number;
  currencyCode: string;
  currencyMinorUnitScale: number;
  dueDay: number;
  limit: string;
  name: string;
  paymentAccountId: string;
}>;

export interface CreditCardRepository {
  insert(card: CreditCard, auditEvent: FinancialAuditEvent): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<CreditCard | null>;
  listForOwner(ownerId: string): Promise<readonly CreditCard[]>;
}

export class GetOwnedCreditCardUseCase {
  public constructor(private readonly cards: CreditCardRepository) {}

  public execute(id: string, actorId: string): Promise<CreditCard | null> {
    return this.cards.findByIdForOwner(id, actorId);
  }
}

export class ListOwnedCreditCardsUseCase {
  public constructor(private readonly cards: CreditCardRepository) {}

  public execute(actorId: string): Promise<readonly CreditCard[]> {
    return this.cards.listForOwner(actorId);
  }
}

export class CreditCardPaymentAccountUnavailableError extends Error {
  public constructor() {
    super('Owned payment account was not found or is unavailable.');
    this.name = 'CreditCardPaymentAccountUnavailableError';
  }
}

export class CreditCardCurrencyMismatchError extends Error {
  public constructor() {
    super('Credit card limit must use the payment account currency.');
    this.name = 'CreditCardCurrencyMismatchError';
  }
}

export class CreateCreditCardUseCase {
  public constructor(
    private readonly accounts: AccountRepository,
    private readonly cards: CreditCardRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateCreditCardCommand): Promise<CreditCard> {
    const account = await this.accounts.findByIdForOwner(
      command.paymentAccountId,
      command.actorId,
    );
    if (account?.lifecycle !== 'active') {
      throw new CreditCardPaymentAccountUnavailableError();
    }
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    if (!currency.equals(account.initialBalance.currency)) {
      throw new CreditCardCurrencyMismatchError();
    }
    const at = this.clock.now();
    const card = CreditCard.create({
      brand: command.brand,
      closingDay: command.closingDay,
      createdAt: at,
      dueDay: command.dueDay,
      id: this.identifiers.generate(),
      limit: Money.fromDecimal(command.limit, currency),
      name: command.name,
      ownerId: command.actorId,
      paymentAccountId: command.paymentAccountId,
    });
    await this.cards.insert(
      card,
      FinancialAuditEvent.create({
        action: 'created',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: at,
        ownerId: command.actorId,
        resourceId: card.id,
        resourceType: 'credit-card',
      }),
    );
    return card;
  }
}
