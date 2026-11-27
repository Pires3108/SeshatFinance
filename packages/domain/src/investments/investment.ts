import { CivilDate } from '../calendar/civil-date.js';
import { Currency, type CurrencySnapshot } from '../money/currency.js';
import { InvestmentType, type InvestmentTypeKey } from './investment-type.js';

export const investmentLifecycles = ['active', 'archived', 'trashed'] as const;
export type InvestmentLifecycle = (typeof investmentLifecycles)[number];

export const investmentIndexers = [
  'cdi',
  'selic',
  'ipca',
  'prefixed',
  'other',
] as const;
export type InvestmentIndexer = (typeof investmentIndexers)[number];

/**
 * Contracted rate (ADR-044): descriptive only, never used to compute cost,
 * value or return. `percent` is a decimal string such as "110" (110% of CDI)
 * or "6.5" (IPCA + 6.5%).
 */
export type ContractedRate = Readonly<{
  indexer: InvestmentIndexer;
  percent: string;
}>;

export type InvestmentLiquidity =
  | Readonly<{ kind: 'daily' }>
  | Readonly<{ kind: 'at-maturity' }>
  | Readonly<{ kind: 'd-plus'; days: number }>;

export const MAX_LIQUIDITY_DAYS = 3650;
export const MAX_UNIT_PRICE_SCALE = 8;
const MAX_RATE_SCALE = 4;
const MAX_TEXT_LENGTH = 120;
const MAX_CODE_LENGTH = 20;

const quantityScales: Readonly<Record<InvestmentTypeKey, number | null>> = {
  stock: 0,
  fii: 0,
  etf: 0,
  cryptocurrency: 8,
  'investment-fund': 6,
  'private-pension': 6,
  'treasury-direct': 2,
  cdb: null,
  lci: null,
  lca: null,
  savings: null,
};

/**
 * Maximum decimal places of a quantity for the investment type (RN-072).
 * `null` means the type has no quantity and is tracked only by value.
 */
export function investmentQuantityScale(
  type: InvestmentTypeKey,
): number | null {
  return quantityScales[type];
}

export type InvestmentSnapshot = Readonly<{
  id: string;
  ownerId: string;
  type: InvestmentTypeKey;
  institution: string;
  name: string;
  code: string | null;
  currency: CurrencySnapshot;
  startDate: string;
  maturityDate: string | null;
  contractedRate: ContractedRate | null;
  liquidity: InvestmentLiquidity;
  lifecycle: InvestmentLifecycle;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}>;

export type InvestmentDetails = Readonly<{
  type: InvestmentType;
  institution: string;
  name: string;
  code: string | null;
  currency: Currency;
  startDate: CivilDate;
  maturityDate: CivilDate | null;
  contractedRate: ContractedRate | null;
  liquidity: InvestmentLiquidity;
}>;

export class InvalidInvestmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidInvestmentError';
  }
}

export class InvestmentLifecycleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvestmentLifecycleError';
  }
}

/**
 * A manually declared investment (US-054, ADR-044). Registering or editing it
 * never records a transaction nor changes balances or net worth. Seshat
 * Finance only records it; nothing is executed at any institution.
 */
export class Investment {
  private constructor(private state: InvestmentSnapshot) {}

  public static create(
    input: InvestmentDetails &
      Readonly<{ id: string; ownerId: string; createdAt: Date }>,
  ): Investment {
    const createdAt = validDate(input.createdAt);
    return new Investment({
      ...normalizeDetails(input),
      id: required(input.id, 'id'),
      ownerId: required(input.ownerId, 'ownerId'),
      lifecycle: 'active',
      createdAt,
      updatedAt: createdAt,
      version: 1,
    });
  }

  public static restore(snapshot: InvestmentSnapshot): Investment {
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
      throw new InvalidInvestmentError(
        'Investment version must be a positive integer.',
      );
    }
    if (!investmentLifecycles.includes(snapshot.lifecycle)) {
      throw new InvalidInvestmentError('Unknown investment lifecycle.');
    }
    return new Investment({
      ...normalizeDetails(detailsFromSnapshot(snapshot)),
      id: required(snapshot.id, 'id'),
      ownerId: required(snapshot.ownerId, 'ownerId'),
      lifecycle: snapshot.lifecycle,
      createdAt: validDate(snapshot.createdAt),
      updatedAt: validDate(snapshot.updatedAt),
      version: snapshot.version,
    });
  }

  public get id(): string {
    return this.state.id;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get type(): InvestmentTypeKey {
    return this.state.type;
  }

  public get currency(): Currency {
    return Currency.restore(this.state.currency);
  }

  public get startDate(): CivilDate {
    return CivilDate.parse(this.state.startDate);
  }

  public get lifecycle(): InvestmentLifecycle {
    return this.state.lifecycle;
  }

  public get version(): number {
    return this.state.version;
  }

  public get quantityScale(): number | null {
    return investmentQuantityScale(this.state.type);
  }

  /**
   * Edits the descriptive data. Type and currency are fixed after creation,
   * because events and reported values are recorded in that currency.
   */
  public update(details: InvestmentDetails, at: Date): void {
    if (this.state.lifecycle !== 'active') {
      throw new InvestmentLifecycleError(
        'Only an active investment can be edited.',
      );
    }
    const next = normalizeDetails(details);
    if (next.type !== this.state.type) {
      throw new InvalidInvestmentError('The investment type cannot change.');
    }
    if (!Currency.restore(next.currency).equals(this.currency)) {
      throw new InvalidInvestmentError(
        'The investment currency cannot change.',
      );
    }
    this.change({ ...this.state, ...next }, at);
  }

  public archive(at: Date): void {
    this.transition('active', 'archived', at);
  }

  public unarchive(at: Date): void {
    this.transition('archived', 'active', at);
  }

  public trash(at: Date): void {
    if (this.state.lifecycle === 'trashed') {
      throw new InvestmentLifecycleError('The investment is already trashed.');
    }
    this.change({ ...this.state, lifecycle: 'trashed' }, at);
  }

  public restoreFromTrash(at: Date): void {
    this.transition('trashed', 'active', at);
  }

  public toSnapshot(): InvestmentSnapshot {
    return {
      ...this.state,
      currency: { ...this.state.currency },
      contractedRate:
        this.state.contractedRate === null
          ? null
          : { ...this.state.contractedRate },
      liquidity: { ...this.state.liquidity },
    };
  }

  private transition(
    from: InvestmentLifecycle,
    to: InvestmentLifecycle,
    at: Date,
  ): void {
    if (this.state.lifecycle !== from) {
      throw new InvestmentLifecycleError(
        `Only a ${from} investment can become ${to}.`,
      );
    }
    this.change({ ...this.state, lifecycle: to }, at);
  }

  private change(next: InvestmentSnapshot, at: Date): void {
    const updatedAt = validDate(at);
    if (updatedAt.getTime() < this.state.updatedAt.getTime()) {
      throw new InvalidInvestmentError(
        'An investment change cannot precede the last one.',
      );
    }
    this.state = { ...next, updatedAt, version: this.state.version + 1 };
  }
}

type NormalizedDetails = Pick<
  InvestmentSnapshot,
  | 'type'
  | 'institution'
  | 'name'
  | 'code'
  | 'currency'
  | 'startDate'
  | 'maturityDate'
  | 'contractedRate'
  | 'liquidity'
>;

function normalizeDetails(details: InvestmentDetails): NormalizedDetails {
  if (
    details.maturityDate !== null &&
    details.maturityDate.compare(details.startDate) < 0
  ) {
    throw new InvalidInvestmentError(
      'The maturity date cannot precede the start date.',
    );
  }
  if (
    details.liquidity.kind === 'at-maturity' &&
    details.maturityDate === null
  ) {
    throw new InvalidInvestmentError(
      'Liquidity at maturity needs a maturity date.',
    );
  }
  return {
    type: details.type.key,
    institution: boundedText(details.institution, 'institution'),
    name: boundedText(details.name, 'name'),
    code: normalizeCode(details.code),
    currency: details.currency.toSnapshot(),
    startDate: details.startDate.toString(),
    maturityDate:
      details.maturityDate === null ? null : details.maturityDate.toString(),
    contractedRate: normalizeRate(details.contractedRate),
    liquidity: normalizeLiquidity(details.liquidity),
  };
}

function normalizeCode(value: string | null): string | null {
  if (value === null) return null;
  const code = value.trim().toUpperCase();
  if (code.length === 0) return null;
  if (code.length > MAX_CODE_LENGTH || !/^[A-Z0-9.\-_]+$/u.test(code)) {
    throw new InvalidInvestmentError(
      'The investment code must have up to 20 letters, digits, ".", "-" or "_".',
    );
  }
  return code;
}

function normalizeRate(rate: ContractedRate | null): ContractedRate | null {
  if (rate === null) return null;
  if (!investmentIndexers.includes(rate.indexer)) {
    throw new InvalidInvestmentError('Unknown investment indexer.');
  }
  return {
    indexer: rate.indexer,
    percent: parseDecimal(rate.percent, MAX_RATE_SCALE, 'contracted rate', {
      allowZero: true,
    }),
  };
}

function normalizeLiquidity(
  liquidity: InvestmentLiquidity,
): InvestmentLiquidity {
  switch (liquidity.kind) {
    case 'daily':
      return { kind: 'daily' };
    case 'at-maturity':
      return { kind: 'at-maturity' };
    case 'd-plus':
      if (
        !Number.isSafeInteger(liquidity.days) ||
        liquidity.days < 0 ||
        liquidity.days > MAX_LIQUIDITY_DAYS
      ) {
        throw new InvalidInvestmentError(
          'Liquidity days must be an integer from 0 to 3650.',
        );
      }
      return { kind: 'd-plus', days: liquidity.days };
    default:
      throw new InvalidInvestmentError('Unknown liquidity.');
  }
}

const decimalPattern = /^(\d+)(?:\.(\d+))?$/u;

/**
 * Validates a non-negative plain decimal string with at most `scale` places
 * and returns it without superfluous zeros. Used for quantities, unit prices
 * and rates (RN-072); none of them is ever a `number`.
 */
export function parseDecimal(
  value: string,
  scale: number,
  label: string,
  options: Readonly<{ allowZero: boolean }>,
): string {
  const match = typeof value === 'string' ? decimalPattern.exec(value) : null;
  if (match === null) {
    throw new InvalidInvestmentError(
      `The ${label} must be a non-negative decimal string.`,
    );
  }
  const integer = (match[1] ?? '').replace(/^0+(?=\d)/u, '');
  const fraction = (match[2] ?? '').replace(/0+$/u, '');
  if (fraction.length > scale) {
    throw new InvalidInvestmentError(
      `The ${label} accepts at most ${String(scale)} decimal places.`,
    );
  }
  if (integer.length > 18) {
    throw new InvalidInvestmentError(`The ${label} is too large.`);
  }
  const normalized = fraction.length === 0 ? integer : `${integer}.${fraction}`;
  if (!options.allowZero && /^0(?:\.0*)?$/u.test(normalized)) {
    throw new InvalidInvestmentError(`The ${label} must be positive.`);
  }
  return normalized;
}

function detailsFromSnapshot(snapshot: InvestmentSnapshot): InvestmentDetails {
  return {
    type: InvestmentType.create(snapshot.type),
    institution: snapshot.institution,
    name: snapshot.name,
    code: snapshot.code,
    currency: Currency.restore(snapshot.currency),
    startDate: CivilDate.parse(snapshot.startDate),
    maturityDate:
      snapshot.maturityDate === null
        ? null
        : CivilDate.parse(snapshot.maturityDate),
    contractedRate: snapshot.contractedRate,
    liquidity: snapshot.liquidity,
  };
}

function boundedText(value: string, field: string): string {
  const text = required(value, field);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new InvalidInvestmentError(
      `The investment ${field} must have at most 120 characters.`,
    );
  }
  return text;
}

function required(value: string, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    throw new InvalidInvestmentError(`The investment ${field} is required.`);
  }
  return trimmed;
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidInvestmentError(
      'Investment instants must be valid dates.',
    );
  }
  return new Date(value.getTime());
}
