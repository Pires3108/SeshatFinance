import { CivilDate } from '../calendar/civil-date.js';
import { Money, type MoneySnapshot } from '../money/money.js';

export const goalModes = ['free', 'linked'] as const;
export type GoalMode = (typeof goalModes)[number];

export const goalLifecycles = ['active', 'paused', 'archived'] as const;
export type GoalLifecycle = (typeof goalLifecycles)[number];

export const MAX_GOAL_ACCOUNT_LINKS = 20;
const MAX_GOAL_NAME_LENGTH = 120;

/**
 * Part of an account's balance that counts for a goal (RN-069, ADR-043):
 * either the whole balance, exclusive to one goal, or a declared amount in
 * the account currency.
 */
export type GoalAccountShare =
  Readonly<{ kind: 'full' }> | Readonly<{ kind: 'amount'; amount: Money }>;

export type GoalAccountLink = Readonly<{
  accountId: string;
  share: GoalAccountShare;
}>;

export type GoalAccountLinkSnapshot = Readonly<{
  accountId: string;
  share:
    | Readonly<{ kind: 'full' }>
    | Readonly<{ kind: 'amount'; amount: MoneySnapshot }>;
}>;

export type GoalSnapshot = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  target: MoneySnapshot;
  initialAmount: MoneySnapshot;
  deadline: string | null;
  mode: GoalMode;
  lifecycle: GoalLifecycle;
  links: readonly GoalAccountLinkSnapshot[];
  createdAt: Date;
  updatedAt: Date;
  version: number;
}>;

export type GoalDetails = Readonly<{
  name: string;
  target: Money;
  initialAmount: Money | null;
  deadline: CivilDate | null;
  mode: GoalMode;
  links: readonly GoalAccountLink[];
}>;

export class InvalidGoalError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidGoalError';
  }
}

export class GoalLifecycleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'GoalLifecycleError';
  }
}

/**
 * A goal declared by the holder (US-049). It organizes progress only:
 * creating or editing it never records a transaction nor changes balances
 * or net worth (RN-033, INV-026).
 */
export class Goal {
  private constructor(private state: GoalSnapshot) {}

  public static create(
    input: GoalDetails &
      Readonly<{ id: string; ownerId: string; createdAt: Date }>,
  ): Goal {
    const createdAt = validDate(input.createdAt);
    return new Goal({
      ...normalizeDetails(input),
      id: required(input.id, 'id'),
      ownerId: required(input.ownerId, 'ownerId'),
      lifecycle: 'active',
      createdAt,
      updatedAt: createdAt,
      version: 1,
    });
  }

  public static restore(snapshot: GoalSnapshot): Goal {
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
      throw new InvalidGoalError('Goal version must be a positive integer.');
    }
    if (!goalLifecycles.includes(snapshot.lifecycle)) {
      throw new InvalidGoalError('Unknown goal lifecycle.');
    }
    const details = normalizeDetails(detailsFromSnapshot(snapshot));
    return new Goal({
      ...details,
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

  public get lifecycle(): GoalLifecycle {
    return this.state.lifecycle;
  }

  public get version(): number {
    return this.state.version;
  }

  public get target(): Money {
    return Money.restore(this.state.target);
  }

  public get initialAmount(): Money {
    return Money.restore(this.state.initialAmount);
  }

  public get deadline(): CivilDate | null {
    return this.state.deadline === null
      ? null
      : CivilDate.parse(this.state.deadline);
  }

  public get links(): readonly GoalAccountLink[] {
    return this.state.links.map(restoreLink);
  }

  public update(details: GoalDetails, at: Date): void {
    if (this.state.lifecycle === 'archived') {
      throw new GoalLifecycleError('An archived goal cannot be edited.');
    }
    this.change({ ...this.state, ...normalizeDetails(details) }, at);
  }

  public pause(at: Date): void {
    this.transition('active', 'paused', at);
  }

  public resume(at: Date): void {
    this.transition('paused', 'active', at);
  }

  public archive(at: Date): void {
    if (this.state.lifecycle === 'archived') {
      throw new GoalLifecycleError('The goal is already archived.');
    }
    this.change({ ...this.state, lifecycle: 'archived' }, at);
  }

  public unarchive(at: Date): void {
    this.transition('archived', 'active', at);
  }

  /**
   * Removes one account from the goal, as chosen in the impact panel. The
   * last account removed turns the goal into a free goal.
   */
  public unlinkAccount(accountId: string, at: Date): void {
    if (this.state.lifecycle === 'archived') {
      throw new GoalLifecycleError('An archived goal cannot be edited.');
    }
    const links = this.state.links.filter(
      (link) => link.accountId !== accountId,
    );
    if (links.length === this.state.links.length) {
      throw new InvalidGoalError('The account is not linked to this goal.');
    }
    this.change(
      { ...this.state, links, mode: links.length === 0 ? 'free' : 'linked' },
      at,
    );
  }

  public toSnapshot(): GoalSnapshot {
    return {
      ...this.state,
      target: { ...this.state.target },
      initialAmount: { ...this.state.initialAmount },
      links: this.state.links.map((link) => ({ ...link })),
    };
  }

  private transition(from: GoalLifecycle, to: GoalLifecycle, at: Date): void {
    if (this.state.lifecycle !== from) {
      throw new GoalLifecycleError(`Only a ${from} goal can become ${to}.`);
    }
    this.change({ ...this.state, lifecycle: to }, at);
  }

  private change(next: GoalSnapshot, at: Date): void {
    const updatedAt = validDate(at);
    if (updatedAt.getTime() < this.state.updatedAt.getTime()) {
      throw new InvalidGoalError('A goal change cannot precede the last one.');
    }
    this.state = { ...next, updatedAt, version: this.state.version + 1 };
  }
}

type NormalizedDetails = Pick<
  GoalSnapshot,
  'name' | 'target' | 'initialAmount' | 'deadline' | 'mode' | 'links'
>;

function normalizeDetails(details: GoalDetails): NormalizedDetails {
  const name = required(details.name, 'name');
  if (name.length > MAX_GOAL_NAME_LENGTH) {
    throw new InvalidGoalError('Goal name must have at most 120 characters.');
  }
  if (details.target.compare(zeroOf(details.target)) <= 0) {
    throw new InvalidGoalError('Goal target must be positive.');
  }
  const initialAmount = details.initialAmount ?? zeroOf(details.target);
  if (!initialAmount.currency.equals(details.target.currency)) {
    throw new InvalidGoalError(
      'Goal initial amount must use the target currency.',
    );
  }
  if (initialAmount.compare(zeroOf(details.target)) < 0) {
    throw new InvalidGoalError('Goal initial amount cannot be negative.');
  }
  if (!goalModes.includes(details.mode)) {
    throw new InvalidGoalError('Unknown goal mode.');
  }
  validateLinks(details.mode, details.links);
  return {
    name,
    target: details.target.toSnapshot(),
    initialAmount: initialAmount.toSnapshot(),
    deadline: details.deadline === null ? null : details.deadline.toString(),
    mode: details.mode,
    links: details.links.map(linkSnapshot),
  };
}

function validateLinks(
  mode: GoalMode,
  links: readonly GoalAccountLink[],
): void {
  if (mode === 'free' && links.length > 0) {
    throw new InvalidGoalError('A free goal has no linked accounts.');
  }
  if (mode === 'linked' && links.length === 0) {
    throw new InvalidGoalError('A linked goal needs at least one account.');
  }
  if (links.length > MAX_GOAL_ACCOUNT_LINKS) {
    throw new InvalidGoalError('A goal accepts at most 20 accounts.');
  }
  const seen = new Set<string>();
  for (const link of links) {
    const accountId = required(link.accountId, 'accountId').toLowerCase();
    if (seen.has(accountId)) {
      throw new InvalidGoalError('An account can be linked once per goal.');
    }
    seen.add(accountId);
    if (
      link.share.kind === 'amount' &&
      link.share.amount.compare(zeroOf(link.share.amount)) <= 0
    ) {
      throw new InvalidGoalError('An account share must be positive.');
    }
  }
}

function linkSnapshot(link: GoalAccountLink): GoalAccountLinkSnapshot {
  return {
    accountId: link.accountId.trim().toLowerCase(),
    share:
      link.share.kind === 'full'
        ? { kind: 'full' }
        : { kind: 'amount', amount: link.share.amount.toSnapshot() },
  };
}

function restoreLink(link: GoalAccountLinkSnapshot): GoalAccountLink {
  return {
    accountId: link.accountId,
    share:
      link.share.kind === 'full'
        ? { kind: 'full' }
        : { kind: 'amount', amount: Money.restore(link.share.amount) },
  };
}

function detailsFromSnapshot(snapshot: GoalSnapshot): GoalDetails {
  return {
    name: snapshot.name,
    target: Money.restore(snapshot.target),
    initialAmount: Money.restore(snapshot.initialAmount),
    deadline:
      snapshot.deadline === null ? null : CivilDate.parse(snapshot.deadline),
    mode: snapshot.mode,
    links: snapshot.links.map(restoreLink),
  };
}

function zeroOf(money: Money): Money {
  return Money.fromMinorUnits(0n, money.currency);
}

function required(value: string, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    throw new InvalidGoalError(`Goal ${field} is required.`);
  }
  return trimmed;
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidGoalError('Goal instants must be valid dates.');
  }
  return new Date(value.getTime());
}
