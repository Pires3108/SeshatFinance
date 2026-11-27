import { CivilDate } from '../calendar/civil-date.js';
import { Money, type MoneySnapshot } from '../money/money.js';
import {
  MAX_UNIT_PRICE_SCALE,
  parseDecimal,
  type Investment,
} from './investment.js';

export const investmentEventKinds = [
  'contribution',
  'redemption',
  'yield',
  'dividend',
  'interest',
  'fee',
  'tax',
] as const;
export type InvestmentEventKind = (typeof investmentEventKinds)[number];

export const investmentEventLifecycles = ['active', 'trashed'] as const;
export type InvestmentEventLifecycle =
  (typeof investmentEventLifecycles)[number];

/** Aporte and resgate: the only events that move quantity and principal. */
const movementKinds: ReadonlySet<InvestmentEventKind> = new Set([
  'contribution',
  'redemption',
]);
/** Rendimento, dividendo e juros (RN-035). */
const incomeKinds: ReadonlySet<InvestmentEventKind> = new Set([
  'yield',
  'dividend',
  'interest',
]);
const MAX_NOTE_LENGTH = 500;

export function isInvestmentMovementKind(kind: InvestmentEventKind): boolean {
  return movementKinds.has(kind);
}

export function isInvestmentIncomeKind(kind: InvestmentEventKind): boolean {
  return incomeKinds.has(kind);
}

/**
 * Kind of the linked account entry (ADR-044): an aporte leaves the account,
 * a resgate and an income enter it, fees and taxes never touch an account.
 */
export function investmentEventAccountEffect(
  kind: InvestmentEventKind,
): 'income' | 'expense' | null {
  if (kind === 'contribution') return 'expense';
  if (kind === 'redemption' || incomeKinds.has(kind)) return 'income';
  return null;
}

export type InvestmentEventSnapshot = Readonly<{
  id: string;
  ownerId: string;
  investmentId: string;
  kind: InvestmentEventKind;
  amount: MoneySnapshot;
  quantity: string | null;
  unitPrice: string | null;
  occurredAt: Date;
  timeZone: string;
  occurredOn: string;
  accountId: string | null;
  transactionId: string | null;
  note: string | null;
  lifecycle: InvestmentEventLifecycle;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}>;

export type CreateInvestmentEventProperties = Readonly<{
  id: string;
  investment: Investment;
  kind: InvestmentEventKind;
  amount: Money;
  quantity: string | null;
  unitPrice: string | null;
  occurredAt: Date;
  timeZone: string;
  accountId: string | null;
  transactionId: string | null;
  note: string | null;
  createdAt: Date;
}>;

export class InvalidInvestmentEventError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidInvestmentEventError';
  }
}

/**
 * A declared aporte, resgate, income, fee or tax of a manual investment
 * (US-055, RN-073). Seshat Finance only records it: nothing is executed at a
 * broker, bank or any external service.
 */
export class InvestmentEvent {
  private constructor(private state: InvestmentEventSnapshot) {}

  public static create(
    properties: CreateInvestmentEventProperties,
  ): InvestmentEvent {
    const { investment } = properties;
    if (investment.lifecycle !== 'active') {
      throw new InvalidInvestmentEventError(
        'Events are recorded only on an active investment.',
      );
    }
    const kind = validKind(properties.kind);
    if (!properties.amount.currency.equals(investment.currency)) {
      throw new InvalidInvestmentEventError(
        'The event must use the currency of the investment.',
      );
    }
    if (properties.amount.isZero() || properties.amount.toMinorUnits() < 0n) {
      throw new InvalidInvestmentEventError(
        'The event amount must be positive.',
      );
    }
    const occurredAt = validDate(properties.occurredAt, 'occurredAt');
    const timeZone = properties.timeZone;
    const occurredOn = civilDateIn(occurredAt, timeZone);
    if (occurredOn.compare(investment.startDate) < 0) {
      throw new InvalidInvestmentEventError(
        'The event cannot precede the investment start date.',
      );
    }
    const { quantity, unitPrice } = quantityAndPrice(
      kind,
      investment.quantityScale,
      properties.quantity,
      properties.unitPrice,
    );
    const accountId = properties.accountId;
    const transactionId = properties.transactionId;
    if (accountId !== null && investmentEventAccountEffect(kind) === null) {
      throw new InvalidInvestmentEventError(
        'Fees and taxes do not move an account.',
      );
    }
    if ((accountId === null) !== (transactionId === null)) {
      throw new InvalidInvestmentEventError(
        'An account and its linked entry are recorded together.',
      );
    }
    const createdAt = validDate(properties.createdAt, 'createdAt');
    return new InvestmentEvent({
      id: required(properties.id, 'id'),
      ownerId: investment.ownerId,
      investmentId: investment.id,
      kind,
      amount: properties.amount.toSnapshot(),
      quantity,
      unitPrice,
      occurredAt,
      timeZone,
      occurredOn: occurredOn.toString(),
      accountId: accountId === null ? null : required(accountId, 'accountId'),
      transactionId:
        transactionId === null
          ? null
          : required(transactionId, 'transactionId'),
      note: normalizeNote(properties.note),
      lifecycle: 'active',
      createdAt,
      updatedAt: createdAt,
      version: 1,
    });
  }

  public static restore(snapshot: InvestmentEventSnapshot): InvestmentEvent {
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
      throw new InvalidInvestmentEventError(
        'Investment event version must be a positive integer.',
      );
    }
    if (!investmentEventLifecycles.includes(snapshot.lifecycle)) {
      throw new InvalidInvestmentEventError('Unknown event lifecycle.');
    }
    return new InvestmentEvent({
      ...snapshot,
      kind: validKind(snapshot.kind),
      amount: Money.restore(snapshot.amount).toSnapshot(),
      occurredOn: CivilDate.parse(snapshot.occurredOn).toString(),
      occurredAt: validDate(snapshot.occurredAt, 'occurredAt'),
      createdAt: validDate(snapshot.createdAt, 'createdAt'),
      updatedAt: validDate(snapshot.updatedAt, 'updatedAt'),
    });
  }

  public get id(): string {
    return this.state.id;
  }

  public get investmentId(): string {
    return this.state.investmentId;
  }

  public get kind(): InvestmentEventKind {
    return this.state.kind;
  }

  public get amount(): Money {
    return Money.restore(this.state.amount);
  }

  public get transactionId(): string | null {
    return this.state.transactionId;
  }

  public get lifecycle(): InvestmentEventLifecycle {
    return this.state.lifecycle;
  }

  public get version(): number {
    return this.state.version;
  }

  /** A trashed event stops counting in position and results (ADR-044). */
  public trash(at: Date): void {
    if (this.state.lifecycle === 'trashed') {
      throw new InvalidInvestmentEventError('The event is already trashed.');
    }
    this.change({ lifecycle: 'trashed' }, at);
  }

  public restoreFromTrash(at: Date): void {
    if (this.state.lifecycle !== 'trashed') {
      throw new InvalidInvestmentEventError('Only a trashed event returns.');
    }
    this.change({ lifecycle: 'active' }, at);
  }

  public toSnapshot(): InvestmentEventSnapshot {
    return { ...this.state };
  }

  private change(
    patch: Partial<Pick<InvestmentEventSnapshot, 'lifecycle'>>,
    at: Date,
  ): void {
    const updatedAt = validDate(at, 'updatedAt');
    if (updatedAt.getTime() < this.state.updatedAt.getTime()) {
      throw new InvalidInvestmentEventError(
        'A change cannot precede the last one.',
      );
    }
    this.state = {
      ...this.state,
      ...patch,
      updatedAt,
      version: this.state.version + 1,
    };
  }
}

function quantityAndPrice(
  kind: InvestmentEventKind,
  scale: number | null,
  quantity: string | null,
  unitPrice: string | null,
): Readonly<{ quantity: string | null; unitPrice: string | null }> {
  if (!movementKinds.has(kind) || scale === null) {
    if (quantity !== null || unitPrice !== null) {
      throw new InvalidInvestmentEventError(
        'Quantity and unit price apply only to aportes and resgates of types with quantity.',
      );
    }
    return { quantity: null, unitPrice: null };
  }
  if (quantity === null) {
    throw new InvalidInvestmentEventError(
      'Aportes and resgates of this type require a quantity.',
    );
  }
  try {
    return {
      quantity: parseDecimal(quantity, scale, 'quantity', { allowZero: false }),
      unitPrice:
        unitPrice === null
          ? null
          : parseDecimal(unitPrice, MAX_UNIT_PRICE_SCALE, 'unit price', {
              allowZero: false,
            }),
    };
  } catch (error) {
    throw new InvalidInvestmentEventError(
      error instanceof Error ? error.message : 'Invalid quantity or price.',
    );
  }
}

/** Civil date of an instant in an explicit IANA zone (ADR-034). */
function civilDateIn(instant: Date, timeZone: string): CivilDate {
  if (
    typeof timeZone !== 'string' ||
    timeZone.trim() === '' ||
    /^[+-]/u.test(timeZone)
  ) {
    throw new InvalidInvestmentEventError('An IANA time zone is required.');
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      calendar: 'iso8601',
      day: '2-digit',
      month: '2-digit',
      numberingSystem: 'latn',
      timeZone,
      year: 'numeric',
    }).formatToParts(instant);
  } catch {
    throw new InvalidInvestmentEventError('An IANA time zone is required.');
  }
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return CivilDate.of(part('year'), part('month'), part('day'));
}

function validKind(kind: InvestmentEventKind): InvestmentEventKind {
  if (!investmentEventKinds.includes(kind)) {
    throw new InvalidInvestmentEventError('Unknown investment event kind.');
  }
  return kind;
}

function normalizeNote(note: string | null): string | null {
  if (note === null) return null;
  const trimmed = note.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new InvalidInvestmentEventError(
      'The note accepts at most 500 characters.',
    );
  }
  return trimmed;
}

function required(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidInvestmentEventError(`The ${label} is required.`);
  }
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InvalidInvestmentEventError(`The ${label} must be a valid date.`);
  }
  return new Date(value.getTime());
}
