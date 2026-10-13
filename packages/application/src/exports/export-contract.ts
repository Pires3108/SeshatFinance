import type { Clock } from '../ports/clock.js';

export const EXPORT_VERSION = '1' as const;
export const MAX_EXPORT_ROWS = 100_000;
export const EXPORT_SETS = [
  'accounts',
  'transactions',
  'transfers',
  'balance_adjustments',
  'categories',
  'tags',
  'cost_centers',
  'credit_cards',
] as const;
export type ExportSet = (typeof EXPORT_SETS)[number];
export type ExportLifecycle = 'active' | 'archived' | 'trashed';
export type ExportMoney = Readonly<{ amount: string; currency: string }>;
export type ExportScalar =
  string | number | null | ExportMoney | readonly string[];
export type ExportRow = Readonly<{
  id: string;
  ownerId: string;
  lifecycle?: ExportLifecycle;
  [field: string]: ExportScalar | undefined;
}>;
export type ExportFilters = Readonly<{
  from: string | null;
  to: string | null;
  accountIds: readonly string[];
  categoryIds: readonly string[];
  entityIds: readonly string[];
  includeArchived: boolean;
  includeTrash: boolean;
  sets: readonly ExportSet[];
}>;
export type ExportSelection = Readonly<{
  from?: unknown;
  to?: unknown;
  accountIds?: unknown;
  categoryIds?: unknown;
  entityIds?: unknown;
  includeArchived?: unknown;
  includeTrash?: unknown;
  sets?: unknown;
  zone?: unknown;
}>;

type FieldKind =
  | 'uuid'
  | 'uuid_list'
  | 'text'
  | 'money'
  | 'instant'
  | 'date'
  | 'state'
  | 'integer';
type Field = Readonly<{ name: string; kind: FieldKind; nullable?: boolean }>;
const common: readonly Field[] = [{ name: 'id', kind: 'uuid' }];
export const EXPORT_SCHEMA: Readonly<Record<ExportSet, readonly Field[]>> = {
  accounts: [
    ...common,
    { name: 'name', kind: 'text' },
    { name: 'type', kind: 'text' },
    { name: 'institution', kind: 'text', nullable: true },
    { name: 'initial_balance', kind: 'money' },
    { name: 'lifecycle', kind: 'state' },
    { name: 'created_at', kind: 'instant' },
  ],
  transactions: [
    ...common,
    { name: 'account_id', kind: 'uuid' },
    { name: 'category_id', kind: 'uuid', nullable: true },
    { name: 'subcategory_id', kind: 'uuid', nullable: true },
    { name: 'cost_center_id', kind: 'uuid', nullable: true },
    { name: 'tag_ids', kind: 'uuid_list' },
    { name: 'kind', kind: 'text' },
    { name: 'amount', kind: 'money' },
    { name: 'description', kind: 'text', nullable: true },
    { name: 'occurred_at', kind: 'instant' },
    { name: 'lifecycle', kind: 'state' },
    { name: 'created_at', kind: 'instant' },
  ],
  transfers: [
    ...common,
    { name: 'source_transaction_id', kind: 'uuid' },
    { name: 'destination_transaction_id', kind: 'uuid' },
    { name: 'created_at', kind: 'instant' },
  ],
  balance_adjustments: [
    ...common,
    { name: 'account_id', kind: 'uuid' },
    { name: 'transaction_id', kind: 'uuid' },
    { name: 'previous_balance', kind: 'money' },
    { name: 'reported_balance', kind: 'money' },
    { name: 'difference', kind: 'money' },
    { name: 'occurred_at', kind: 'instant' },
    { name: 'created_at', kind: 'instant' },
  ],
  categories: [
    ...common,
    { name: 'name', kind: 'text' },
    { name: 'parent_category_id', kind: 'uuid', nullable: true },
    { name: 'created_at', kind: 'instant' },
  ],
  tags: [
    ...common,
    { name: 'name', kind: 'text' },
    { name: 'created_at', kind: 'instant' },
  ],
  cost_centers: [
    ...common,
    { name: 'name', kind: 'text' },
    { name: 'created_at', kind: 'instant' },
  ],
  credit_cards: [
    ...common,
    { name: 'name', kind: 'text' },
    { name: 'brand', kind: 'text' },
    { name: 'payment_account_id', kind: 'uuid' },
    { name: 'limit', kind: 'money' },
    { name: 'closing_day', kind: 'integer' },
    { name: 'due_day', kind: 'integer' },
    { name: 'created_at', kind: 'instant' },
  ],
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const civil = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u;
const decimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

export class InvalidExportError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidExportError';
  }
}

function ids(value: unknown, label: string): readonly string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((id: unknown) => typeof id !== 'string' || !uuid.test(id))
  )
    throw new InvalidExportError(`${label} must contain UUIDs.`);
  return [...new Set(value as string[])].sort();
}

export function parseExportSelection(
  input: ExportSelection | null,
): Readonly<{ filters: ExportFilters; zone: string }> {
  if (input === null) throw new InvalidExportError('Selection is required.');
  const allowed = new Set([
    'from',
    'to',
    'accountIds',
    'categoryIds',
    'entityIds',
    'includeArchived',
    'includeTrash',
    'sets',
    'zone',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new InvalidExportError('Unknown selection field.');
  const sets = input.sets;
  if (
    !Array.isArray(sets) ||
    sets.length === 0 ||
    sets.some((set: unknown) => !EXPORT_SETS.includes(set as ExportSet))
  )
    throw new InvalidExportError(
      'At least one supported data set is required.',
    );
  const from = input.from ?? null;
  const to = input.to ?? null;
  for (const date of [from, to])
    if (date !== null && (typeof date !== 'string' || !validCivil(date)))
      throw new InvalidExportError(
        'Period must use valid YYYY-MM-DD civil dates.',
      );
  if (typeof from === 'string' && typeof to === 'string' && from > to)
    throw new InvalidExportError('Period start exceeds end.');
  if (Array.isArray(input.entityIds) && input.entityIds.length > 0)
    throw new InvalidExportError(
      'Entity filters are not supported in version 1.',
    );
  const zone = input.zone;
  if (typeof zone !== 'string' || zone.length > 128)
    throw new InvalidExportError('IANA zone is required.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    throw new InvalidExportError('IANA zone is invalid.');
  }
  for (const flag of [input.includeArchived, input.includeTrash])
    if (flag !== undefined && typeof flag !== 'boolean')
      throw new InvalidExportError('Lifecycle flags must be boolean.');
  return {
    zone,
    filters: {
      from: from as string | null,
      to: to as string | null,
      accountIds: ids(input.accountIds, 'accountIds'),
      categoryIds: ids(input.categoryIds, 'categoryIds'),
      entityIds: ids(input.entityIds, 'entityIds'),
      includeArchived: input.includeArchived === true,
      includeTrash: input.includeTrash === true,
      sets: EXPORT_SETS.filter((set) => sets.includes(set)),
    },
  };
}

function validCivil(value: string): boolean {
  if (!civil.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function validValue(value: unknown, field: Field): boolean {
  if (value === null) return field.nullable === true;
  if (field.kind === 'money')
    return (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(',') === 'amount,currency' &&
      typeof (value as ExportMoney).amount === 'string' &&
      decimal.test((value as ExportMoney).amount) &&
      typeof (value as ExportMoney).currency === 'string' &&
      /^[A-Z]{3}$/u.test((value as ExportMoney).currency)
    );
  if (field.kind === 'integer')
    return typeof value === 'number' && Number.isSafeInteger(value);
  if (field.kind === 'uuid_list')
    return (
      Array.isArray(value) &&
      value.every((id: unknown) => typeof id === 'string' && uuid.test(id))
    );
  if (typeof value !== 'string') return false;
  if (field.kind === 'uuid') return uuid.test(value);
  if (field.kind === 'date') return validCivil(value);
  if (field.kind === 'instant')
    return (
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString() === value
    );
  if (field.kind === 'state')
    return ['active', 'archived', 'trashed'].includes(value);
  return true;
}

export function canonicalizeExportRows(
  set: ExportSet,
  rows: readonly ExportRow[],
  actorId: string,
  filters: ExportFilters,
): readonly Record<string, ExportScalar>[] {
  if (!uuid.test(actorId))
    throw new InvalidExportError('Authenticated actor is invalid.');
  const fields = EXPORT_SCHEMA[set];
  const selected: Record<string, ExportScalar>[] = [];
  for (const row of rows) {
    if (row.ownerId !== actorId)
      throw new InvalidExportError('Reader returned an unauthorized record.');
    if (row.lifecycle === 'trashed' && !filters.includeTrash) continue;
    if (row.lifecycle === 'archived' && !filters.includeArchived) continue;
    if (
      filters.accountIds.length > 0 &&
      set === 'accounts' &&
      !filters.accountIds.includes(row.id)
    )
      continue;
    if (
      filters.accountIds.length > 0 &&
      'account_id' in row &&
      (typeof row.account_id !== 'string' ||
        !filters.accountIds.includes(row.account_id))
    )
      continue;
    if (
      filters.categoryIds.length > 0 &&
      set === 'transactions' &&
      ![row.category_id, row.subcategory_id].some(
        (id) => typeof id === 'string' && filters.categoryIds.includes(id),
      )
    )
      continue;
    const output: Record<string, ExportScalar> = {};
    for (const field of fields) {
      const value = row[field.name];
      if (!validValue(value, field))
        throw new InvalidExportError(`Invalid ${set}.${field.name}.`);
      output[field.name] = value as ExportScalar;
    }
    selected.push(output);
  }
  return selected.sort((a, b) => {
    const aDate = sortableText(a.occurred_at ?? a.name ?? a.created_at);
    const bDate = sortableText(b.occurred_at ?? b.name ?? b.created_at);
    return (
      aDate.localeCompare(bDate, 'en') ||
      sortableText(a.created_at).localeCompare(
        sortableText(b.created_at),
        'en',
      ) ||
      sortableText(a.id).localeCompare(sortableText(b.id), 'en')
    );
  });
}

function sortableText(value: ExportScalar | undefined): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').toLocaleLowerCase('en')
    : '';
}

export interface AuthorizedExportReader {
  /** Reject foreign selected IDs; resolve visibility at generation time. */
  assertAuthorizedSelection(
    actorId: string,
    filters: ExportFilters,
    zone: string,
  ): Promise<void>;
  /** Apply inclusive civil period in the selected IANA zone and preserve required references. */
  readAuthorized(
    set: ExportSet,
    actorId: string,
    filters: ExportFilters,
    zone: string,
  ): Promise<readonly ExportRow[]>;
}

type CanonicalRows = readonly Record<string, ExportScalar>[];
type ExportData = Partial<Record<ExportSet, CanonicalRows>>;

function referencedIds(
  data: ExportData,
): Partial<Record<ExportSet, Set<string>>> {
  const references: Partial<Record<ExportSet, Set<string>>> = {};
  const add = (set: ExportSet, value: ExportScalar | undefined): void => {
    if (typeof value !== 'string') return;
    (references[set] ??= new Set<string>()).add(value);
  };
  for (const row of data.transactions ?? []) {
    add('accounts', row.account_id);
    add('categories', row.category_id);
    add('categories', row.subcategory_id);
    add('cost_centers', row.cost_center_id);
    if (Array.isArray(row.tag_ids))
      for (const tagId of row.tag_ids as readonly unknown[])
        if (typeof tagId === 'string') add('tags', tagId);
  }
  for (const row of data.transfers ?? []) {
    add('transactions', row.source_transaction_id);
    add('transactions', row.destination_transaction_id);
  }
  for (const row of data.balance_adjustments ?? []) {
    add('transactions', row.transaction_id);
    add('accounts', row.account_id);
  }
  for (const row of data.credit_cards ?? [])
    add('accounts', row.payment_account_id);
  for (const row of data.categories ?? [])
    add('categories', row.parent_category_id);
  return references;
}

export class BuildExportUseCase {
  public constructor(
    private readonly reader: AuthorizedExportReader,
    private readonly clock: Clock,
  ) {}
  public async execute(
    actorId: string,
    selection: ExportSelection,
  ): Promise<
    Readonly<{
      version: '1';
      generated_at: string;
      zone: string;
      filters: ExportFilters;
      reference_inclusions: Readonly<
        Partial<Record<ExportSet, readonly string[]>>
      >;
      data: Readonly<
        Partial<Record<ExportSet, readonly Record<string, ExportScalar>[]>>
      >;
    }>
  > {
    const { filters, zone } = parseExportSelection(selection);
    if (!uuid.test(actorId))
      throw new InvalidExportError('Authenticated actor is invalid.');
    await this.reader.assertAuthorizedSelection(actorId, filters, zone);
    const data: Partial<
      Record<ExportSet, readonly Record<string, ExportScalar>[]>
    > = {};
    for (const set of filters.sets)
      data[set] = canonicalizeExportRows(
        set,
        await this.reader.readAuthorized(set, actorId, filters, zone),
        actorId,
        filters,
      );
    assertExportRowLimit(data);
    const referenceInclusions: Partial<Record<ExportSet, readonly string[]>> =
      {};
    const completeFilters: ExportFilters = {
      ...filters,
      from: null,
      to: null,
      accountIds: [],
      categoryIds: [],
      includeArchived: true,
    };
    const fullRows: Partial<Record<ExportSet, CanonicalRows>> = {};
    for (;;) {
      const references = referencedIds(data);
      let changed = false;
      for (const set of EXPORT_SETS) {
        const required = references[set];
        if (required === undefined) continue;
        const existing = new Set((data[set] ?? []).map((row) => row.id));
        const missing = [...required].filter((id) => !existing.has(id));
        if (missing.length === 0) continue;
        fullRows[set] ??= canonicalizeExportRows(
          set,
          await this.reader.readAuthorized(set, actorId, completeFilters, zone),
          actorId,
          completeFilters,
        );
        const found = fullRows[set].filter(
          (row) => typeof row.id === 'string' && missing.includes(row.id),
        );
        if (found.length !== missing.length)
          throw new InvalidExportError(
            'Required reference is unavailable. If the related record is in the trash, retry with includeTrash.',
          );
        data[set] = canonicalizeExportRows(
          set,
          [...(data[set] ?? []), ...found].map((row) => ({
            ...row,
            id: row.id as string,
            ownerId: actorId,
          })),
          actorId,
          completeFilters,
        );
        assertExportRowLimit(data);
        referenceInclusions[set] = [
          ...new Set([...(referenceInclusions[set] ?? []), ...missing]),
        ].sort();
        changed = true;
      }
      if (!changed) break;
    }
    return {
      version: EXPORT_VERSION,
      generated_at: this.clock.now().toISOString(),
      zone,
      filters,
      reference_inclusions: referenceInclusions,
      data,
    };
  }
}

function assertExportRowLimit(data: ExportData): void {
  const count = EXPORT_SETS.reduce(
    (sum, set) => sum + (data[set]?.length ?? 0),
    0,
  );
  if (count > MAX_EXPORT_ROWS)
    throw new InvalidExportError('Export exceeds the version 1 row limit.');
}

export function serializeExportJson(
  document: Awaited<ReturnType<BuildExportUseCase['execute']>>,
): string {
  return `${JSON.stringify(document)}\n`;
}

function csvCell(value: ExportScalar, textField: boolean): string {
  let rendered =
    value === null
      ? ''
      : Array.isArray(value)
        ? JSON.stringify(value)
        : typeof value === 'object' && 'amount' in value
          ? `${value.amount} ${value.currency}`
          : String(value);
  if (textField && /^\s*[=+\-@]/u.test(rendered)) rendered = `'${rendered}`;
  if (textField && /^[\t\r\n]/u.test(rendered)) rendered = `'${rendered}`;
  return /[",\r\n]/u.test(rendered)
    ? `"${rendered.replaceAll('"', '""')}"`
    : rendered;
}

export function serializeExportCsv(
  set: ExportSet,
  rows: readonly Record<string, ExportScalar>[],
): string {
  const fields = EXPORT_SCHEMA[set];
  const header = fields.flatMap((field) =>
    field.kind === 'money'
      ? [`${field.name}_amount`, `${field.name}_currency`]
      : [field.name],
  );
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      fields
        .flatMap((field) => {
          const value = row[field.name];
          if (value === undefined || !validValue(value, field))
            throw new InvalidExportError(`Invalid ${set}.${field.name}.`);
          if (field.kind === 'money') {
            const money = value as ExportMoney;
            return [
              csvCell(money.amount, false),
              csvCell(money.currency, false),
            ];
          }
          return [csvCell(value, field.kind === 'text')];
        })
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function serializeExportCsvBundle(
  document: Awaited<ReturnType<BuildExportUseCase['execute']>>,
): Readonly<{
  manifest: string;
  tables: Readonly<Partial<Record<ExportSet, string>>>;
}> {
  const tables: Partial<Record<ExportSet, string>> = {};
  const sets = EXPORT_SETS.filter((set) => document.data[set] !== undefined);
  for (const set of sets)
    tables[set] = serializeExportCsv(set, document.data[set] ?? []);
  const manifest = `${JSON.stringify({ version: document.version, generated_at: document.generated_at, zone: document.zone, filters: document.filters, sets, reference_inclusions: document.reference_inclusions })}\n`;
  return { manifest, tables };
}
