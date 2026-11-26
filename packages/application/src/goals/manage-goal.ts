import {
  calculateGoalProgress,
  CivilDate,
  Currency,
  FinancialAuditEvent,
  Goal,
  Money,
  type Account,
  type FinancialAuditAction,
  type GoalAccountLink,
  type GoalAccountPosition,
  type GoalAccountShare,
  type GoalContributionPosition,
  type GoalDetails,
  type GoalMode,
  type GoalProgress,
  type GoalSnapshot,
  type ManualExchangeQuote,
  type PresentationQuote,
} from '@seshat/domain';

import { readCivilDate } from '../ports/civil-date.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';
import type { UserProfileRepository } from '../users/update-own-user-profile.js';

export const CREATE_GOAL_OPERATION = 'goal.create';

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

/** An amount or full share another non-archived goal holds on an account. */
export type ExistingAccountShare = Readonly<{
  goalId: string;
  accountId: string;
  share: GoalAccountShare;
}>;

export type GoalWrite = Readonly<{
  goal: Goal;
  auditEvent: FinancialAuditEvent;
}>;

export interface GoalRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<Goal | null>;
  listForOwner(ownerId: string): Promise<readonly Goal[]>;
  /** Shares held by the owner's non-archived goals on these accounts. */
  listSharesForAccounts(
    ownerId: string,
    accountIds: readonly string[],
  ): Promise<readonly ExistingAccountShare[]>;
  /**
   * Claims the key, locks the owner's accounts, reads their current shares
   * and lets `build` validate the new goal against them; then writes the
   * goal, its links, the audit and the stored response in one transaction.
   */
  insertAtomically(
    request: IdempotencyRequest,
    ownerId: string,
    accountIds: readonly string[],
    build: (shares: readonly ExistingAccountShare[]) => GoalWrite,
    serialize: (goal: Goal) => string,
  ): Promise<string>;
  /**
   * Locks the goal and the accounts, checks the expected version and saves
   * what `build` returns with its audit. Returns null when the goal does not
   * exist for the owner.
   */
  saveAtomically(
    goalId: string,
    ownerId: string,
    expectedVersion: number,
    accountIds: readonly string[],
    build: (goal: Goal, shares: readonly ExistingAccountShare[]) => GoalWrite,
  ): Promise<Goal | null>;
}

/** Account facts the Goals module reads through the Accounts public API. */
export type GoalAccountView = Readonly<{
  id: string;
  name: string;
  lifecycle: Account['lifecycle'];
  balance: Money;
}>;

export interface GoalAccountDirectory {
  findOwned(
    ownerId: string,
    accountIds: readonly string[],
  ): Promise<readonly GoalAccountView[]>;
}

/** Composes the public account use cases into the view Goals needs. */
export class OwnedGoalAccountDirectory implements GoalAccountDirectory {
  public constructor(
    private readonly accounts: Readonly<{
      execute(accountId: string, actorId: string): Promise<Account | null>;
    }>,
    private readonly balances: Readonly<{
      execute(accountId: string, actorId: string): Promise<Money>;
    }>,
  ) {}

  public async findOwned(
    ownerId: string,
    accountIds: readonly string[],
  ): Promise<readonly GoalAccountView[]> {
    const views: GoalAccountView[] = [];
    for (const accountId of new Set(accountIds)) {
      const account = await this.accounts.execute(accountId, ownerId);
      if (account === null) continue;
      views.push({
        balance: await this.balances.execute(account.id, ownerId),
        id: account.id.toLowerCase(),
        lifecycle: account.lifecycle,
        name: account.toSnapshot().name,
      });
    }
    return views;
  }
}

export interface GoalQuoteSource {
  execute(actorId: string): Promise<readonly ManualExchangeQuote[]>;
}

/** Today in the holder's time zone and the current instant (RII-012). */
export class GoalCalendar {
  public constructor(
    private readonly profiles: Pick<UserProfileRepository, 'findById'>,
    private readonly clock: Clock,
  ) {}

  public async today(ownerId: string): Promise<CivilDate> {
    const profile = await this.profiles.findById(ownerId);
    return CivilDate.parse(
      readCivilDate(this.clock, profile?.timeZone ?? DEFAULT_TIME_ZONE),
    );
  }

  public now(): Date {
    return this.clock.now();
  }
}

export type GoalView = Readonly<{
  goal: Goal;
  progress: GoalProgress;
  accounts: readonly GoalAccountView[];
}>;

export class GoalNotFoundError extends Error {
  public constructor() {
    super('Owned goal was not found.');
    this.name = 'GoalNotFoundError';
  }
}

export class GoalAccountUnavailableError extends Error {
  public constructor() {
    super('Owned account available for the goal was not found.');
    this.name = 'GoalAccountUnavailableError';
  }
}

export class GoalShareCurrencyError extends Error {
  public constructor() {
    super('An account share must use the account currency.');
    this.name = 'GoalShareCurrencyError';
  }
}

export class GoalShareConflictError extends Error {
  public constructor() {
    super('A full share is exclusive to one goal.');
    this.name = 'GoalShareConflictError';
  }
}

export class GoalShareExceedsBalanceError extends Error {
  public constructor() {
    super('Account shares cannot exceed the account balance.');
    this.name = 'GoalShareExceedsBalanceError';
  }
}

export class GoalVersionConflictError extends Error {
  public constructor() {
    super('The goal was changed by another request.');
    this.name = 'GoalVersionConflictError';
  }
}

export type GoalShareInput =
  Readonly<{ kind: 'full' }> | Readonly<{ kind: 'amount'; amount: string }>;

export type GoalDetailsInput = Readonly<{
  name: string;
  target: string;
  currencyCode: string;
  currencyMinorUnitScale: number;
  initialAmount?: string | null | undefined;
  deadline?: string | null | undefined;
  mode: GoalMode;
  links: readonly Readonly<{ accountId: string; share: GoalShareInput }>[];
}>;

export type CreateGoalCommand = GoalDetailsInput &
  Readonly<{ actorId: string; idempotencyKey: string }>;

export type UpdateGoalCommand = GoalDetailsInput &
  Readonly<{ actorId: string; goalId: string; expectedVersion: number }>;

export type GoalLifecycleAction = 'pause' | 'resume' | 'archive' | 'unarchive';

export type ChangeGoalLifecycleCommand = Readonly<{
  actorId: string;
  goalId: string;
  expectedVersion: number;
  action: GoalLifecycleAction;
}>;

export type UnlinkGoalAccountCommand = Readonly<{
  actorId: string;
  goalId: string;
  accountId: string;
  expectedVersion: number;
}>;

/** Builds goal views with their derived progress. */
export class GoalProgressReader {
  public constructor(
    private readonly goals: Pick<GoalRepository, 'listSharesForAccounts'>,
    private readonly accounts: GoalAccountDirectory,
    private readonly quotes: GoalQuoteSource,
    private readonly calendar: GoalCalendar,
    private readonly contributions?: Readonly<{
      listPositionsForGoals(
        ownerId: string,
        goalIds: readonly string[],
      ): Promise<ReadonlyMap<string, readonly GoalContributionPosition[]>>;
    }>,
  ) {}

  public async views(
    ownerId: string,
    goals: readonly Goal[],
  ): Promise<readonly GoalView[]> {
    const accountIds = [
      ...new Set(goals.flatMap((goal) => goal.links.map((l) => l.accountId))),
    ];
    const accounts =
      accountIds.length === 0
        ? []
        : await this.accounts.findOwned(ownerId, accountIds);
    const shares =
      accountIds.length === 0
        ? []
        : await this.goals.listSharesForAccounts(ownerId, accountIds);
    const contributions =
      this.contributions === undefined || goals.length === 0
        ? new Map<string, readonly GoalContributionPosition[]>()
        : await this.contributions.listPositionsForGoals(
            ownerId,
            goals.map((goal) => goal.id),
          );
    const needsQuotes = goals.some(
      (goal) =>
        goal.links.some((link) => {
          const account = accounts.find((a) => a.id === link.accountId);
          return (
            account !== undefined &&
            !account.balance.currency.equals(goal.target.currency)
          );
        }) ||
        (contributions.get(goal.id) ?? []).some(
          (line) => !line.amount.currency.equals(goal.target.currency),
        ),
    );
    const quotes = needsQuotes
      ? (await this.quotes.execute(ownerId)).map(toQuote)
      : [];
    const today = await this.calendar.today(ownerId);
    const now = this.calendar.now();
    return goals.map((goal) => {
      const linked = goal.links.map((link) =>
        accounts.find((account) => account.id === link.accountId),
      );
      return {
        accounts: linked.filter(
          (account): account is GoalAccountView => account !== undefined,
        ),
        goal,
        progress: calculateGoalProgress({
          contributions: contributions.get(goal.id) ?? [],
          goal,
          now,
          positions: positionsFor(goal, accounts, shares),
          quotes,
          today,
        }),
      };
    });
  }

  public async view(ownerId: string, goal: Goal): Promise<GoalView> {
    const [view] = await this.views(ownerId, [goal]);
    if (view === undefined) throw new GoalNotFoundError();
    return view;
  }
}

/** Declares a goal; it never records a transaction (US-049, INV-026). */
export class CreateGoalUseCase {
  public constructor(
    private readonly goals: GoalRepository,
    private readonly accounts: GoalAccountDirectory,
    private readonly reader: GoalProgressReader,
    private readonly calendar: GoalCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateGoalCommand): Promise<GoalView> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.calendar.now();
    const request: IdempotencyRequest = {
      key,
      operation: CREATE_GOAL_OPERATION,
      ownerId: command.actorId,
      payload: { details: JSON.stringify(normalizeInput(command)) },
      requestedAt: at,
    };
    const replayed = await this.goals.findIdempotentResponse(request);
    if (replayed !== null) {
      return this.reader.view(command.actorId, parseGoalResponse(replayed));
    }

    const accountIds = command.links.map((l) => l.accountId.toLowerCase());
    const accounts = await this.accounts.findOwned(command.actorId, accountIds);
    const details = toDetails(command, accounts);
    const goal = Goal.create({
      ...details,
      createdAt: at,
      id: this.identifiers.generate(),
      ownerId: command.actorId,
    });
    const auditId = this.identifiers.generate();
    const stored = await this.goals.insertAtomically(
      request,
      command.actorId,
      accountIds,
      (shares) => {
        assertShares(goal.links, [], accounts, shares, goal.id);
        return {
          auditEvent: audit(command.actorId, at, auditId, goal.id, 'created'),
          goal,
        };
      },
      serializeGoalResponse,
    );
    return this.reader.view(command.actorId, parseGoalResponse(stored));
  }
}

export class ListGoalsUseCase {
  public constructor(
    private readonly goals: GoalRepository,
    private readonly reader: GoalProgressReader,
  ) {}

  public async execute(actorId: string): Promise<readonly GoalView[]> {
    return this.reader.views(actorId, await this.goals.listForOwner(actorId));
  }
}

export class GetGoalUseCase {
  public constructor(
    private readonly goals: GoalRepository,
    private readonly reader: GoalProgressReader,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; goalId: string }>,
  ): Promise<GoalView> {
    const goal = await this.goals.findByIdForOwner(query.goalId, query.actorId);
    if (goal === null) throw new GoalNotFoundError();
    return this.reader.view(query.actorId, goal);
  }
}

/** Replaces the details of a goal; only new or changed shares are revalidated. */
export class UpdateGoalUseCase {
  public constructor(
    private readonly goals: GoalRepository,
    private readonly accounts: GoalAccountDirectory,
    private readonly reader: GoalProgressReader,
    private readonly calendar: GoalCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: UpdateGoalCommand): Promise<GoalView> {
    const at = this.calendar.now();
    const accountIds = command.links.map((l) => l.accountId.toLowerCase());
    const accounts = await this.accounts.findOwned(command.actorId, accountIds);
    const details = toDetails(command, accounts);
    const auditId = this.identifiers.generate();
    const saved = await this.goals.saveAtomically(
      command.goalId,
      command.actorId,
      command.expectedVersion,
      accountIds,
      (goal, shares) => {
        const previous = goal.links;
        goal.update(details, at);
        assertShares(goal.links, previous, accounts, shares, goal.id);
        return {
          auditEvent: audit(command.actorId, at, auditId, goal.id, 'updated'),
          goal,
        };
      },
    );
    if (saved === null) throw new GoalNotFoundError();
    return this.reader.view(command.actorId, saved);
  }
}

/**
 * Pauses, resumes, archives or unarchives a goal. Archiving releases its
 * shares; unarchiving claims them again against the current balances.
 */
export class ChangeGoalLifecycleUseCase {
  public constructor(
    private readonly goals: GoalRepository,
    private readonly accounts: GoalAccountDirectory,
    private readonly reader: GoalProgressReader,
    private readonly calendar: GoalCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: ChangeGoalLifecycleCommand): Promise<GoalView> {
    const at = this.calendar.now();
    const current = await this.goals.findByIdForOwner(
      command.goalId,
      command.actorId,
    );
    if (current === null) throw new GoalNotFoundError();
    const accountIds = current.links.map((link) => link.accountId);
    const accounts =
      command.action === 'unarchive'
        ? await this.accounts.findOwned(command.actorId, accountIds)
        : [];
    const auditId = this.identifiers.generate();
    const saved = await this.goals.saveAtomically(
      command.goalId,
      command.actorId,
      command.expectedVersion,
      command.action === 'unarchive' ? accountIds : [],
      (goal, shares) => {
        const action = applyLifecycle(goal, command.action, at);
        if (command.action === 'unarchive') {
          assertShares(goal.links, [], accounts, shares, goal.id);
        }
        return {
          auditEvent: audit(command.actorId, at, auditId, goal.id, action),
          goal,
        };
      },
    );
    if (saved === null) throw new GoalNotFoundError();
    return this.reader.view(command.actorId, saved);
  }
}

/** Removes an account from a goal, as chosen in the impact panel. */
export class UnlinkGoalAccountUseCase {
  public constructor(
    private readonly goals: GoalRepository,
    private readonly reader: GoalProgressReader,
    private readonly calendar: GoalCalendar,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: UnlinkGoalAccountCommand): Promise<GoalView> {
    const at = this.calendar.now();
    const auditId = this.identifiers.generate();
    const saved = await this.goals.saveAtomically(
      command.goalId,
      command.actorId,
      command.expectedVersion,
      [],
      (goal) => {
        goal.unlinkAccount(command.accountId.toLowerCase(), at);
        return {
          auditEvent: audit(command.actorId, at, auditId, goal.id, 'updated'),
          goal,
        };
      },
    );
    if (saved === null) throw new GoalNotFoundError();
    return this.reader.view(command.actorId, saved);
  }
}

/**
 * Lists the non-archived goals that use an account, so the holder chooses,
 * goal by goal, what to do before archiving or trashing it (US-049).
 */
export class GetAccountGoalImpactUseCase {
  public constructor(
    private readonly goals: GoalRepository,
    private readonly accounts: GoalAccountDirectory,
    private readonly reader: GoalProgressReader,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; accountId: string }>,
  ): Promise<readonly GoalView[]> {
    const accountId = query.accountId.toLowerCase();
    const [account] = await this.accounts.findOwned(query.actorId, [accountId]);
    if (account === undefined) throw new GoalAccountUnavailableError();
    const shares = await this.goals.listSharesForAccounts(query.actorId, [
      accountId,
    ]);
    const goals: Goal[] = [];
    for (const goalId of new Set(shares.map((share) => share.goalId))) {
      const goal = await this.goals.findByIdForOwner(goalId, query.actorId);
      if (goal !== null) goals.push(goal);
    }
    return this.reader.views(query.actorId, goals);
  }
}

export function serializeGoalResponse(goal: Goal): string {
  const snapshot = goal.toSnapshot();
  return JSON.stringify({
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  });
}

export function parseGoalResponse(response: string): Goal {
  const raw = JSON.parse(response) as GoalSnapshot & {
    createdAt: string;
    updatedAt: string;
  };
  return Goal.restore({
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  });
}

function applyLifecycle(
  goal: Goal,
  action: GoalLifecycleAction,
  at: Date,
): FinancialAuditAction {
  switch (action) {
    case 'pause':
      goal.pause(at);
      return 'updated';
    case 'resume':
      goal.resume(at);
      return 'updated';
    case 'archive':
      goal.archive(at);
      return 'archived';
    case 'unarchive':
      goal.unarchive(at);
      return 'unarchived';
  }
}

/**
 * RN-069: a full share is exclusive and an amount share fits, with the other
 * goals' shares, in the account balance at declaration. Unchanged shares are
 * not revalidated, so a later balance drop never blocks unrelated edits.
 */
function assertShares(
  links: readonly GoalAccountLink[],
  previous: readonly GoalAccountLink[],
  accounts: readonly GoalAccountView[],
  shares: readonly ExistingAccountShare[],
  goalId: string,
): void {
  for (const link of links) {
    const account = accounts.find((a) => a.id === link.accountId);
    if (account === undefined || account.lifecycle === 'trashed') {
      throw new GoalAccountUnavailableError();
    }
    const before = previous.find((p) => p.accountId === link.accountId);
    if (before !== undefined && sameShare(before.share, link.share)) continue;
    if (account.lifecycle !== 'active') throw new GoalAccountUnavailableError();
    if (
      link.share.kind === 'amount' &&
      !link.share.amount.currency.equals(account.balance.currency)
    ) {
      throw new GoalShareCurrencyError();
    }
    const others = shares.filter(
      (s) => s.accountId === link.accountId && s.goalId !== goalId,
    );
    if (link.share.kind === 'full') {
      if (others.length > 0) throw new GoalShareConflictError();
      continue;
    }
    if (others.some((s) => s.share.kind === 'full')) {
      throw new GoalShareConflictError();
    }
    const total = others.reduce(
      (sum, s) => (s.share.kind === 'amount' ? sum.add(s.share.amount) : sum),
      link.share.amount,
    );
    if (total.compare(account.balance) > 0) {
      throw new GoalShareExceedsBalanceError();
    }
  }
}

function sameShare(left: GoalAccountShare, right: GoalAccountShare): boolean {
  if (left.kind === 'full' || right.kind === 'full') {
    return left.kind === right.kind;
  }
  return left.amount.equals(right.amount);
}

function positionsFor(
  goal: Goal,
  accounts: readonly GoalAccountView[],
  shares: readonly ExistingAccountShare[],
): ReadonlyMap<string, GoalAccountPosition> {
  const positions = new Map<string, GoalAccountPosition>();
  for (const link of goal.links) {
    const account = accounts.find((a) => a.id === link.accountId);
    const currency =
      link.share.kind === 'amount'
        ? link.share.amount.currency
        : (account?.balance.currency ?? goal.target.currency);
    const own =
      link.share.kind === 'amount'
        ? link.share.amount
        : Money.fromMinorUnits(0n, currency);
    const declared = shares
      .filter((s) => s.accountId === link.accountId && s.goalId !== goal.id)
      .reduce(
        (sum, s) =>
          s.share.kind === 'amount' && s.share.amount.currency.equals(currency)
            ? sum.add(s.share.amount)
            : sum,
        own,
      );
    positions.set(link.accountId, {
      accountId: link.accountId,
      balance: account?.balance ?? Money.fromMinorUnits(0n, currency),
      declaredAmountShares: declared,
      // A purged or foreign account cannot count; treat it as trashed.
      lifecycle: account?.lifecycle ?? 'trashed',
    });
  }
  return positions;
}

function toDetails(
  input: GoalDetailsInput,
  accounts: readonly GoalAccountView[],
): GoalDetails {
  const currency = Currency.create(
    input.currencyCode,
    input.currencyMinorUnitScale,
  );
  return {
    deadline:
      input.deadline === null || input.deadline === undefined
        ? null
        : CivilDate.parse(input.deadline),
    initialAmount:
      input.initialAmount === null || input.initialAmount === undefined
        ? null
        : Money.fromDecimal(input.initialAmount, currency),
    links: input.links.map((link) => {
      const accountId = link.accountId.toLowerCase();
      if (link.share.kind === 'full') {
        return { accountId, share: { kind: 'full' } };
      }
      const account = accounts.find((a) => a.id === accountId);
      if (account === undefined) throw new GoalAccountUnavailableError();
      return {
        accountId,
        share: {
          amount: Money.fromDecimal(
            link.share.amount,
            account.balance.currency,
          ),
          kind: 'amount',
        },
      };
    }),
    mode: input.mode,
    name: input.name,
    target: Money.fromDecimal(input.target, currency),
  };
}

function normalizeInput(input: GoalDetailsInput): unknown {
  return {
    currencyCode: input.currencyCode,
    currencyMinorUnitScale: input.currencyMinorUnitScale,
    deadline: input.deadline ?? null,
    initialAmount: input.initialAmount ?? null,
    links: input.links.map((link) => ({
      accountId: link.accountId.toLowerCase(),
      share: link.share,
    })),
    mode: input.mode,
    name: input.name.trim(),
    target: input.target,
  };
}

function toQuote(quote: ManualExchangeQuote): PresentationQuote {
  const snapshot = quote.toSnapshot();
  return {
    effectiveAt: snapshot.effectiveAt,
    id: snapshot.id,
    rate: snapshot.rate,
    source: snapshot.source,
    sourceCurrencyCode: snapshot.sourceCurrencyCode,
    targetCurrencyCode: snapshot.targetCurrencyCode,
  };
}

function audit(
  actorId: string,
  at: Date,
  id: string,
  goalId: string,
  action: FinancialAuditAction,
): FinancialAuditEvent {
  return FinancialAuditEvent.create({
    action,
    actorId,
    id,
    occurredAt: at,
    ownerId: actorId,
    resourceId: goalId,
    resourceType: 'goal',
  });
}
