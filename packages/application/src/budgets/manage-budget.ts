import {
  Budget,
  calculateBudgetConsumption,
  calculateBudgetRealized,
  Currency,
  FinancialAuditEvent,
  isBudgetMonth,
  Money,
  type BudgetConsumption,
  type BudgetDimension,
  type BudgetEntry,
  type BudgetMonth,
  type BudgetSnapshot,
  type FinancialAuditAction,
} from '@seshat/domain';

import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { TemporalView } from '../transactions/list-temporal-transactions.js';

export const CREATE_BUDGET_OPERATION = 'budget.create';

export type BudgetWrite = Readonly<{
  budget: Budget;
  auditEvent: FinancialAuditEvent;
}>;

export interface BudgetRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<Budget | null>;
  listForOwner(ownerId: string): Promise<readonly Budget[]>;
  /**
   * Claims the key and inserts the budget with its audit and stored
   * response. Throws BudgetOverlapError when an active budget already
   * covers the same dimension and currency.
   */
  insertAtomically(
    request: IdempotencyRequest,
    write: BudgetWrite,
    serialize: (budget: Budget) => string,
  ): Promise<string>;
  /** Locks, checks the version and saves; null when not owned. */
  saveAtomically(
    id: string,
    ownerId: string,
    expectedVersion: number,
    build: (budget: Budget) => BudgetWrite,
  ): Promise<Budget | null>;
}

/** Whether the dimension belongs to the holder (Classifications/Accounts). */
export interface BudgetDimensionDirectory {
  isOwned(ownerId: string, dimension: BudgetDimension): Promise<boolean>;
}

export class OwnedBudgetDimensionDirectory implements BudgetDimensionDirectory {
  public constructor(
    private readonly categories: Readonly<{
      execute(actorId: string): Promise<readonly Readonly<{ id: string }>[]>;
    }>,
    private readonly costCenters: Readonly<{
      execute(actorId: string): Promise<readonly Readonly<{ id: string }>[]>;
    }>,
    private readonly accounts: Readonly<{
      execute(accountId: string, actorId: string): Promise<unknown>;
    }>,
  ) {}

  public async isOwned(
    ownerId: string,
    dimension: BudgetDimension,
  ): Promise<boolean> {
    const id = dimension.id.toLowerCase();
    if (dimension.kind === 'account') {
      return (await this.accounts.execute(id, ownerId)) !== null;
    }
    const items =
      dimension.kind === 'category'
        ? await this.categories.execute(ownerId)
        : await this.costCenters.execute(ownerId);
    return items.some((item) => item.id.toLowerCase() === id);
  }
}

/** Entries of one civil month, read through the Transactions module. */
export interface BudgetEntrySource {
  entriesFor(
    ownerId: string,
    month: BudgetMonth,
  ): Promise<readonly BudgetEntry[]>;
}

/**
 * Uses the public temporal view (month in the profile time zone, interval
 * [first day, first day of next month)), so budgets reconcile with it.
 */
export class TemporalBudgetEntrySource implements BudgetEntrySource {
  public constructor(
    private readonly temporal: Readonly<{
      execute(
        actorId: string,
        period: 'month',
        selectedDate: string,
      ): Promise<TemporalView>;
    }>,
  ) {}

  public async entriesFor(
    ownerId: string,
    month: BudgetMonth,
  ): Promise<readonly BudgetEntry[]> {
    const view = await this.temporal.execute(ownerId, 'month', `${month}-01`);
    return view.days.flatMap((day) =>
      day.transactions.map((item) => {
        const snapshot = item.transaction.toSnapshot();
        return {
          accountId: snapshot.accountId,
          amount: item.transaction.amount,
          categoryId: snapshot.categoryId ?? null,
          costCenterId: snapshot.costCenterId ?? null,
          subcategoryId: snapshot.subcategoryId ?? null,
          id: snapshot.id,
          kind: snapshot.kind,
          notSpending:
            item.cardSettlement === true ||
            item.transfer === true ||
            item.balanceAdjustment === true,
          refundOfExpenseId: item.refundOfExpenseId ?? null,
        };
      }),
    );
  }
}

/** Current civil month in the holder's time zone. */
export interface BudgetCalendar {
  today(ownerId: string): Promise<Readonly<{ toString(): string }>>;
  now(): Date;
}

export class BudgetNotFoundError extends Error {
  public constructor() {
    super('Owned budget was not found.');
    this.name = 'BudgetNotFoundError';
  }
}

export class BudgetDimensionUnavailableError extends Error {
  public constructor() {
    super('The budget dimension was not found for the holder.');
    this.name = 'BudgetDimensionUnavailableError';
  }
}

/** Two active budgets for the same dimension and currency (ADR-043). */
export class BudgetOverlapError extends Error {
  public constructor() {
    super('An active budget already covers this dimension and currency.');
    this.name = 'BudgetOverlapError';
  }
}

export class BudgetVersionConflictError extends Error {
  public constructor() {
    super('The budget was changed by another request.');
    this.name = 'BudgetVersionConflictError';
  }
}

export class InvalidBudgetMonthError extends Error {
  public constructor() {
    super('The month must be YYYY-MM.');
    this.name = 'InvalidBudgetMonthError';
  }
}

export type BudgetView = Readonly<{
  budget: Budget;
  month: BudgetMonth;
  /** Null when the budget starts after the month. */
  consumption: BudgetConsumption | null;
  countedEntries: number;
  otherCurrencyEntries: number;
}>;

export type CreateBudgetCommand = Readonly<{
  actorId: string;
  idempotencyKey: string;
  name: string;
  dimension: BudgetDimension;
  limit: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  effectiveFrom?: string | undefined;
}>;

export type ChangeBudgetCommand = Readonly<{
  actorId: string;
  budgetId: string;
  expectedVersion: number;
  name: string;
  limit: string;
  effectiveFrom: string;
}>;

export type BudgetLifecycleCommand = Readonly<{
  actorId: string;
  budgetId: string;
  expectedVersion: number;
  action: 'archive' | 'unarchive';
}>;

async function currentMonth(
  calendar: BudgetCalendar,
  ownerId: string,
): Promise<BudgetMonth> {
  return (await calendar.today(ownerId)).toString().slice(0, 7);
}

/** Derives the consumption of budgets for one month (projection only). */
export class BudgetConsumptionReader {
  public constructor(
    private readonly entries: BudgetEntrySource,
    private readonly calendar: BudgetCalendar,
  ) {}

  public async views(
    ownerId: string,
    budgets: readonly Budget[],
    month?: string,
  ): Promise<readonly BudgetView[]> {
    const selected = month ?? (await currentMonth(this.calendar, ownerId));
    if (!isBudgetMonth(selected)) throw new InvalidBudgetMonthError();
    const entries =
      budgets.length === 0
        ? []
        : await this.entries.entriesFor(ownerId, selected);
    return budgets.map((budget) => {
      const limit = budget.limitFor(selected);
      const realized = calculateBudgetRealized(budget, entries);
      return {
        budget,
        consumption:
          limit === null
            ? null
            : calculateBudgetConsumption(limit, realized.realized),
        countedEntries: realized.countedEntries,
        month: selected,
        otherCurrencyEntries: realized.otherCurrencyEntries,
      };
    });
  }
}

export class CreateBudgetUseCase {
  public constructor(
    private readonly budgets: BudgetRepository,
    private readonly dimensions: BudgetDimensionDirectory,
    private readonly reader: BudgetConsumptionReader,
    private readonly calendar: BudgetCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateBudgetCommand): Promise<BudgetView> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.calendar.now();
    const month = await currentMonth(this.calendar, command.actorId);
    const effectiveFrom = command.effectiveFrom ?? month;
    const request: IdempotencyRequest = {
      key,
      operation: CREATE_BUDGET_OPERATION,
      ownerId: command.actorId,
      payload: {
        currency: `${command.currencyCode}:${String(command.currencyMinorUnitScale)}`,
        dimension: `${command.dimension.kind}:${command.dimension.id.toLowerCase()}`,
        effectiveFrom,
        limit: command.limit.trim(),
        name: command.name.trim(),
      },
      requestedAt: at,
    };
    const replayed = await this.budgets.findIdempotentResponse(request);
    if (replayed !== null) {
      return this.view(command.actorId, parseBudgetResponse(replayed));
    }
    if (effectiveFrom < month) throw new InvalidBudgetMonthError();
    if (!(await this.dimensions.isOwned(command.actorId, command.dimension))) {
      throw new BudgetDimensionUnavailableError();
    }
    const currency = Currency.create(
      command.currencyCode,
      command.currencyMinorUnitScale,
    );
    const budget = Budget.create({
      createdAt: at,
      dimension: command.dimension,
      effectiveFrom,
      id: this.identifiers.generate(),
      limit: Money.fromDecimal(command.limit.trim(), currency),
      name: command.name,
      ownerId: command.actorId,
    });
    const stored = await this.budgets.insertAtomically(
      request,
      {
        auditEvent: audit(
          command.actorId,
          at,
          this.identifiers.generate(),
          budget.id,
          'created',
        ),
        budget,
      },
      serializeBudgetResponse,
    );
    return this.view(command.actorId, parseBudgetResponse(stored));
  }

  private async view(ownerId: string, budget: Budget): Promise<BudgetView> {
    const [view] = await this.reader.views(ownerId, [budget]);
    if (view === undefined) throw new BudgetNotFoundError();
    return view;
  }
}

export class ListBudgetsUseCase {
  public constructor(
    private readonly budgets: Pick<BudgetRepository, 'listForOwner'>,
    private readonly reader: BudgetConsumptionReader,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; month?: string | undefined }>,
  ): Promise<readonly BudgetView[]> {
    return this.reader.views(
      query.actorId,
      await this.budgets.listForOwner(query.actorId),
      query.month,
    );
  }
}

export class ChangeBudgetUseCase {
  public constructor(
    private readonly budgets: BudgetRepository,
    private readonly reader: BudgetConsumptionReader,
    private readonly calendar: BudgetCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: ChangeBudgetCommand): Promise<BudgetView> {
    const at = this.calendar.now();
    const month = await currentMonth(this.calendar, command.actorId);
    const auditId = this.identifiers.generate();
    const saved = await this.budgets.saveAtomically(
      command.budgetId,
      command.actorId,
      command.expectedVersion,
      (budget) => {
        budget.change(
          {
            currentMonth: month,
            effectiveFrom: command.effectiveFrom,
            limit: Money.fromDecimal(command.limit.trim(), budget.currency),
            name: command.name,
          },
          at,
        );
        return {
          auditEvent: audit(command.actorId, at, auditId, budget.id, 'updated'),
          budget,
        };
      },
    );
    if (saved === null) throw new BudgetNotFoundError();
    const [view] = await this.reader.views(command.actorId, [saved]);
    if (view === undefined) throw new BudgetNotFoundError();
    return view;
  }
}

export class ChangeBudgetLifecycleUseCase {
  public constructor(
    private readonly budgets: BudgetRepository,
    private readonly reader: BudgetConsumptionReader,
    private readonly calendar: BudgetCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: BudgetLifecycleCommand): Promise<BudgetView> {
    const at = this.calendar.now();
    const auditId = this.identifiers.generate();
    const saved = await this.budgets.saveAtomically(
      command.budgetId,
      command.actorId,
      command.expectedVersion,
      (budget) => {
        if (command.action === 'archive') budget.archive(at);
        else budget.unarchive(at);
        return {
          auditEvent: audit(
            command.actorId,
            at,
            auditId,
            budget.id,
            command.action === 'archive' ? 'archived' : 'unarchived',
          ),
          budget,
        };
      },
    );
    if (saved === null) throw new BudgetNotFoundError();
    const [view] = await this.reader.views(command.actorId, [saved]);
    if (view === undefined) throw new BudgetNotFoundError();
    return view;
  }
}

function audit(
  actorId: string,
  at: Date,
  id: string,
  budgetId: string,
  action: FinancialAuditAction,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId,
    id,
    occurredAt: at,
    ownerId: actorId,
    resourceId: budgetId,
    resourceType: 'budget',
  });
}

export function serializeBudgetResponse(budget: Budget): string {
  const snapshot = budget.toSnapshot();
  return JSON.stringify({
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  });
}

export function parseBudgetResponse(response: string): Budget {
  const raw = JSON.parse(response) as Omit<
    BudgetSnapshot,
    'createdAt' | 'updatedAt'
  > & { createdAt: string; updatedAt: string };
  return Budget.restore({
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  });
}
