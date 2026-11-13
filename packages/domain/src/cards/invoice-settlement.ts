import { CivilDate } from '../calendar/civil-date.js';
import { Money, type MoneySnapshot } from '../money/money.js';

/**
 * The holder's declaration that an invoice was paid outside Seshat Finance
 * (US-041). It reduces the paying account and the invoice obligation by the
 * same amount and never creates a new expense (INV-015).
 */
export type InvoiceSettlementSnapshot = Readonly<{
  id: string;
  ownerId: string;
  cardId: string;
  invoiceClosesOn: string;
  accountId: string;
  /** Account movement that carries the balance effect. */
  transactionId: string;
  amount: MoneySnapshot;
  paidAt: Date;
  createdAt: Date;
}>;

export type CreateInvoiceSettlementProperties = Readonly<{
  id: string;
  ownerId: string;
  cardId: string;
  invoiceClosesOn: CivilDate;
  accountId: string;
  transactionId: string;
  amount: Money;
  paidAt: Date;
  createdAt: Date;
}>;

export class InvalidInvoiceSettlementError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidInvoiceSettlementError';
  }
}

export class InvoiceSettlement {
  private constructor(private readonly state: InvoiceSettlementSnapshot) {}

  public static create(
    properties: CreateInvoiceSettlementProperties,
  ): InvoiceSettlement {
    for (const [label, value] of [
      ['id', properties.id],
      ['owner id', properties.ownerId],
      ['card id', properties.cardId],
      ['account id', properties.accountId],
      ['transaction id', properties.transactionId],
    ] as const) {
      if (value.trim() === '') {
        throw new InvalidInvoiceSettlementError(
          `Settlement ${label} is required.`,
        );
      }
    }
    if (properties.amount.toMinorUnits() <= 0n) {
      throw new InvalidInvoiceSettlementError(
        'Settlement amount must be positive.',
      );
    }
    for (const instant of [properties.paidAt, properties.createdAt]) {
      if (Number.isNaN(instant.getTime())) {
        throw new InvalidInvoiceSettlementError(
          'Settlement instants must be valid.',
        );
      }
    }
    return new InvoiceSettlement({
      accountId: properties.accountId,
      amount: properties.amount.toSnapshot(),
      cardId: properties.cardId,
      createdAt: new Date(properties.createdAt),
      id: properties.id,
      invoiceClosesOn: properties.invoiceClosesOn.toString(),
      ownerId: properties.ownerId,
      paidAt: new Date(properties.paidAt),
      transactionId: properties.transactionId,
    });
  }

  public static restore(
    snapshot: InvoiceSettlementSnapshot,
  ): InvoiceSettlement {
    return InvoiceSettlement.create({
      ...snapshot,
      amount: Money.restore(snapshot.amount),
      invoiceClosesOn: CivilDate.parse(snapshot.invoiceClosesOn),
    });
  }

  public get id(): string {
    return this.state.id;
  }

  public get amount(): Money {
    return Money.restore(this.state.amount);
  }

  public toSnapshot(): InvoiceSettlementSnapshot {
    return {
      ...this.state,
      amount: {
        amount: this.state.amount.amount,
        currency: { ...this.state.amount.currency },
      },
      createdAt: new Date(this.state.createdAt),
      paidAt: new Date(this.state.paidAt),
    };
  }
}
