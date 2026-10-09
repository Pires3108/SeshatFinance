export const counterpartyTypes = ['person', 'company', 'institution'] as const;
export type CounterpartyType = (typeof counterpartyTypes)[number];
export const counterpartyStatuses = ['active', 'inactive', 'merged'] as const;
export type CounterpartyStatus = (typeof counterpartyStatuses)[number];

export type CounterpartySnapshot = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  type: CounterpartyType;
  email: string | null;
  phone: string | null;
  document: string | null;
  notes: string | null;
  status: CounterpartyStatus;
  mergedIntoId: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}>;

export type CounterpartyDetails = Pick<
  CounterpartySnapshot,
  'name' | 'type' | 'email' | 'phone' | 'document' | 'notes'
>;

export class InvalidCounterpartyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidCounterpartyError';
  }
}

export class Counterparty {
  private constructor(private state: CounterpartySnapshot) {}

  public static create(
    input: CounterpartyDetails & {
      id: string;
      ownerId: string;
      createdAt: Date;
    },
  ): Counterparty {
    const state: CounterpartySnapshot = {
      ...normalizeDetails(input),
      id: required(input.id, 'id'),
      ownerId: required(input.ownerId, 'ownerId'),
      status: 'active',
      mergedIntoId: null,
      createdAt: validDate(input.createdAt),
      updatedAt: validDate(input.createdAt),
      version: 1,
    };
    return new Counterparty(state);
  }

  public static restore(state: CounterpartySnapshot): Counterparty {
    if (!Number.isSafeInteger(state.version) || state.version < 1)
      throw new InvalidCounterpartyError('Invalid version.');
    if (state.status === 'merged' && state.mergedIntoId === null)
      throw new InvalidCounterpartyError('Merged counterparty needs a target.');
    if (state.status !== 'merged' && state.mergedIntoId !== null)
      throw new InvalidCounterpartyError(
        'Unmerged counterparty cannot have a target.',
      );
    return new Counterparty({
      ...state,
      ...normalizeDetails(state),
      createdAt: validDate(state.createdAt),
      updatedAt: validDate(state.updatedAt),
    });
  }

  public get id(): string {
    return this.state.id;
  }
  public get ownerId(): string {
    return this.state.ownerId;
  }

  public update(details: CounterpartyDetails, at: Date): void {
    this.assertNotMerged();
    this.change({ ...this.state, ...normalizeDetails(details) }, at);
  }

  public deactivate(at: Date): void {
    if (this.state.status !== 'active')
      throw new InvalidCounterpartyError(
        'Only active counterparties can be deactivated.',
      );
    this.change({ ...this.state, status: 'inactive' }, at);
  }

  public reactivate(at: Date): void {
    if (this.state.status !== 'inactive')
      throw new InvalidCounterpartyError(
        'Only inactive counterparties can be reactivated.',
      );
    this.change({ ...this.state, status: 'active' }, at);
  }

  public mergeInto(targetId: string, at: Date): void {
    this.assertNotMerged();
    if (this.id === targetId)
      throw new InvalidCounterpartyError(
        'A counterparty cannot merge into itself.',
      );
    this.change(
      {
        ...this.state,
        status: 'merged',
        mergedIntoId: required(targetId, 'targetId'),
      },
      at,
    );
  }

  public toSnapshot(): CounterpartySnapshot {
    return {
      ...this.state,
      createdAt: new Date(this.state.createdAt),
      updatedAt: new Date(this.state.updatedAt),
    };
  }

  private assertNotMerged(): void {
    if (this.state.status === 'merged')
      throw new InvalidCounterpartyError(
        'Merged counterparties cannot be modified.',
      );
  }

  private change(next: CounterpartySnapshot, at: Date): void {
    const instant = validDate(at);
    if (instant < this.state.updatedAt)
      throw new InvalidCounterpartyError(
        'Update cannot precede previous update.',
      );
    this.state = {
      ...next,
      updatedAt: instant,
      version: this.state.version + 1,
    };
  }
}

function required(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new InvalidCounterpartyError(`${label} is required.`);
  return value.trim();
}

function optional(
  value: string | null,
  max: number,
  label: string,
): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (normalized.length > max)
    throw new InvalidCounterpartyError(`${label} is too long.`);
  return normalized.length === 0 ? null : normalized;
}

function normalizeDetails(value: CounterpartyDetails): CounterpartyDetails {
  const name = required(value.name, 'name');
  if (name.length > 200)
    throw new InvalidCounterpartyError('Name is too long.');
  if (!counterpartyTypes.includes(value.type))
    throw new InvalidCounterpartyError('Invalid type.');
  const email = optional(value.email, 254, 'email')?.toLowerCase() ?? null;
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new InvalidCounterpartyError('Invalid email.');
  const phone =
    optional(value.phone, 40, 'phone')?.replace(/[\s().-]/g, '') ?? null;
  if (phone !== null && !/^\+?[0-9]{7,15}$/.test(phone))
    throw new InvalidCounterpartyError('Invalid phone.');
  const document =
    optional(value.document, 40, 'document')
      ?.replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase() ?? null;
  return {
    name,
    type: value.type,
    email,
    phone,
    document,
    notes: optional(value.notes, 2000, 'notes'),
  };
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new InvalidCounterpartyError('Invalid instant.');
  return new Date(value);
}
