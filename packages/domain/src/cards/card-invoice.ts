import { CivilDate } from '../calendar/civil-date.js';
import { Currency, type CurrencySnapshot } from '../money/currency.js';
import { Money, type MoneySnapshot } from '../money/money.js';
import type { CardClosingBoundary, CardCycle } from './card-cycle-schedule.js';

export type CardInvoiceStatus = 'open' | 'closed';

/**
 * One invoice per card cycle. Dates, rule and holiday dataset are frozen when
 * the invoice is formed, so later card or dataset changes never rewrite it.
 */
export type CardInvoiceSnapshot = Readonly<{
  id: string;
  ownerId: string;
  cardId: string;
  closesOn: string;
  firstPurchaseDate: string;
  lastPurchaseDate: string;
  scheduledDueOn: string;
  dueOn: string;
  closingBoundary: CardClosingBoundary;
  configurationPending: boolean;
  holidayDatasetVersion: string;
  timeZone: string;
  currency: CurrencySnapshot;
  status: CardInvoiceStatus;
  closedAt: Date | null;
  /** Purchases total frozen at closing; null while open. */
  closedTotal: MoneySnapshot | null;
  createdAt: Date;
  version: number;
}>;

export type FormCardInvoiceProperties = Readonly<{
  id: string;
  ownerId: string;
  cardId: string;
  cycle: CardCycle;
  closingBoundary: CardClosingBoundary;
  holidayDatasetVersion: string;
  timeZone: string;
  currency: Currency;
  createdAt: Date;
}>;

export class InvalidCardInvoiceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCardInvoiceError';
  }
}

export class CardInvoice {
  private constructor(private readonly state: CardInvoiceSnapshot) {}

  /** Forms an open invoice for a cycle, freezing its dates and rule. */
  public static form(properties: FormCardInvoiceProperties): CardInvoice {
    return CardInvoice.restore({
      cardId: properties.cardId,
      closedAt: null,
      closedTotal: null,
      closesOn: properties.cycle.closesOn.toString(),
      closingBoundary: properties.closingBoundary,
      configurationPending: properties.cycle.configurationPending,
      createdAt: properties.createdAt,
      currency: properties.currency.toSnapshot(),
      dueOn: properties.cycle.dueOn.toString(),
      firstPurchaseDate: properties.cycle.firstPurchaseDate.toString(),
      holidayDatasetVersion: properties.holidayDatasetVersion,
      id: properties.id,
      lastPurchaseDate: properties.cycle.lastPurchaseDate.toString(),
      ownerId: properties.ownerId,
      scheduledDueOn: properties.cycle.scheduledDueOn.toString(),
      status: 'open',
      timeZone: properties.timeZone,
      version: 1,
    });
  }

  public static restore(snapshot: CardInvoiceSnapshot): CardInvoice {
    for (const [label, value] of [
      ['id', snapshot.id],
      ['owner id', snapshot.ownerId],
      ['card id', snapshot.cardId],
      ['time zone', snapshot.timeZone],
      ['holiday dataset version', snapshot.holidayDatasetVersion],
    ] as const) {
      if (value.trim() === '') {
        throw new InvalidCardInvoiceError(`Invoice ${label} is required.`);
      }
    }
    const first = CivilDate.parse(snapshot.firstPurchaseDate);
    const last = CivilDate.parse(snapshot.lastPurchaseDate);
    const closes = CivilDate.parse(snapshot.closesOn);
    const due = CivilDate.parse(snapshot.dueOn);
    const scheduled = CivilDate.parse(snapshot.scheduledDueOn);
    if (
      first.compare(last) > 0 ||
      last.compare(closes) > 0 ||
      due.compare(scheduled) < 0
    ) {
      throw new InvalidCardInvoiceError('Invoice dates are inconsistent.');
    }
    const currency = Currency.restore(snapshot.currency);
    const closed = snapshot.status === 'closed';
    if (
      closed !==
        (snapshot.closedAt !== null && snapshot.closedTotal !== null) ||
      (snapshot.status !== 'open' && !closed)
    ) {
      throw new InvalidCardInvoiceError('Invoice status is inconsistent.');
    }
    if (snapshot.closedTotal !== null) {
      const total = Money.restore(snapshot.closedTotal);
      if (!total.currency.equals(currency) || total.toMinorUnits() < 0n) {
        throw new InvalidCardInvoiceError('Invoice total is invalid.');
      }
    }
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
      throw new InvalidCardInvoiceError('Invoice version must be positive.');
    }
    return new CardInvoice({
      ...snapshot,
      closedAt: snapshot.closedAt === null ? null : new Date(snapshot.closedAt),
      createdAt: new Date(snapshot.createdAt),
      currency: currency.toSnapshot(),
    });
  }

  /** Closes the invoice with its purchases total; closing twice is a no-op. */
  public close(purchasesTotal: Money, at: Date): CardInvoice {
    if (this.state.status === 'closed') return this;
    if (!purchasesTotal.currency.equals(this.currency)) {
      throw new InvalidCardInvoiceError('Invoice total currency differs.');
    }
    return CardInvoice.restore({
      ...this.state,
      closedAt: at,
      closedTotal: purchasesTotal.toSnapshot(),
      status: 'closed',
      version: this.state.version + 1,
    });
  }

  public get id(): string {
    return this.state.id;
  }

  public get cardId(): string {
    return this.state.cardId;
  }

  public get closesOn(): CivilDate {
    return CivilDate.parse(this.state.closesOn);
  }

  public get status(): CardInvoiceStatus {
    return this.state.status;
  }

  public get currency(): Currency {
    return Currency.restore(this.state.currency);
  }

  public get version(): number {
    return this.state.version;
  }

  public toSnapshot(): CardInvoiceSnapshot {
    return {
      ...this.state,
      closedAt:
        this.state.closedAt === null ? null : new Date(this.state.closedAt),
      closedTotal:
        this.state.closedTotal === null
          ? null
          : {
              amount: this.state.closedTotal.amount,
              currency: { ...this.state.closedTotal.currency },
            },
      createdAt: new Date(this.state.createdAt),
      currency: { ...this.state.currency },
    };
  }
}
