import {
  ContributionDistribution,
  FinancialAuditEvent,
  Money,
  type ContributionDistributionSnapshot,
  type GoalContributionPosition,
  type GoalLifecycle,
} from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  normalizeIdempotencyKey,
  type IdempotencyRequest,
} from '../ports/idempotency.js';

export const DISTRIBUTE_CONTRIBUTION_OPERATION = 'goal-contribution.distribute';

/**
 * An entry that can feed goals (ADR-043, RN-070): an income or the incoming
 * side of a transfer. Refund entries, balance adjustments and invoice
 * settlements are never eligible.
 */
export type ContributionSourceView = Readonly<{
  id: string;
  accountId: string;
  amount: Money;
  kind: 'income' | 'transfer-in';
  lifecycle: 'active' | 'archived' | 'trashed';
  occurredAt: Date;
  description: string | null;
}>;

export type ContributionSourceSummary = ContributionSourceView &
  Readonly<{ allocated: Money | null; version: number }>;

export type ContributionGoalState = Readonly<{
  id: string;
  lifecycle: GoalLifecycle;
}>;

export type ContributionWrite = Readonly<{
  distribution: ContributionDistribution;
  auditEvent: FinancialAuditEvent;
}>;

export interface GoalContributionRepository {
  findIdempotentResponse(request: IdempotencyRequest): Promise<string | null>;
  findDistribution(
    sourceId: string,
    ownerId: string,
  ): Promise<ContributionDistribution | null>;
  /** The owned entry when it is eligible, whatever its lifecycle. */
  findSource(
    sourceId: string,
    ownerId: string,
  ): Promise<ContributionSourceView | null>;
  /** Recent eligible entries that are not in the trash. */
  listSources(ownerId: string): Promise<readonly ContributionSourceSummary[]>;
  /** Contribution lines of these goals with the current entry facts. */
  listPositionsForGoals(
    ownerId: string,
    goalIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly GoalContributionPosition[]>>;
  /**
   * Claims the key, locks the entry (one distribution change at a time per
   * source), checks the version (0 when none exists), reads the entry and
   * the target goals, and saves what `build` returns with its audit and the
   * stored response in one transaction.
   */
  saveAtomically(
    request: IdempotencyRequest,
    sourceId: string,
    expectedVersion: number,
    goalIds: readonly string[],
    build: (
      current: ContributionDistribution | null,
      source: ContributionSourceView,
      goals: readonly ContributionGoalState[],
    ) => ContributionWrite,
    serialize: (distribution: ContributionDistribution) => string,
  ): Promise<string>;
}

export class ContributionSourceNotFoundError extends Error {
  public constructor() {
    super('Owned eligible entry was not found.');
    this.name = 'ContributionSourceNotFoundError';
  }
}

/** The entry is in the trash; it cannot receive a new distribution. */
export class ContributionSourceUnavailableError extends Error {
  public constructor() {
    super('A trashed entry cannot be distributed.');
    this.name = 'ContributionSourceUnavailableError';
  }
}

export class ContributionGoalUnavailableError extends Error {
  public constructor() {
    super('Every goal must be owned and not archived.');
    this.name = 'ContributionGoalUnavailableError';
  }
}

export class ContributionVersionConflictError extends Error {
  public constructor() {
    super('The distribution was changed by another request.');
    this.name = 'ContributionVersionConflictError';
  }
}

export type ContributionView = Readonly<{
  source: ContributionSourceView;
  lines: readonly Readonly<{ goalId: string; amount: Money }>[];
  allocated: Money;
  remaining: Money;
  version: number;
}>;

export type DistributeContributionCommand = Readonly<{
  actorId: string;
  sourceTransactionId: string;
  expectedVersion: number;
  lines: readonly Readonly<{ goalId: string; amount: string }>[];
  idempotencyKey: string;
}>;

/**
 * Splits one eligible entry between goals, or corrects/removes the split
 * (US-050). The entry is never changed and keeps its full balance value.
 */
export class DistributeContributionUseCase {
  public constructor(
    private readonly contributions: GoalContributionRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: DistributeContributionCommand,
  ): Promise<ContributionView> {
    const key = normalizeIdempotencyKey(command.idempotencyKey);
    const at = this.clock.now();
    const sourceId = command.sourceTransactionId.trim().toLowerCase();
    const lines = command.lines.map((line) => ({
      amount: line.amount.trim(),
      goalId: line.goalId.trim().toLowerCase(),
    }));
    const request: IdempotencyRequest = {
      key,
      operation: DISTRIBUTE_CONTRIBUTION_OPERATION,
      ownerId: command.actorId,
      payload: {
        expectedVersion: command.expectedVersion,
        lines: JSON.stringify(lines),
        sourceId,
      },
      requestedAt: at,
    };
    const source = await this.contributions.findSource(
      sourceId,
      command.actorId,
    );
    if (source === null) throw new ContributionSourceNotFoundError();
    const replayed = await this.contributions.findIdempotentResponse(request);
    if (replayed !== null) {
      return viewOf(source, parseContributionResponse(replayed));
    }
    const auditId = this.identifiers.generate();
    const stored = await this.contributions.saveAtomically(
      request,
      sourceId,
      command.expectedVersion,
      lines.map((line) => line.goalId),
      (current, locked, goals) => {
        if ((current?.version ?? 0) !== command.expectedVersion) {
          throw new ContributionVersionConflictError();
        }
        if (locked.lifecycle === 'trashed') {
          throw new ContributionSourceUnavailableError();
        }
        const usable = new Set(
          goals.filter((g) => g.lifecycle !== 'archived').map((g) => g.id),
        );
        if (lines.some((line) => !usable.has(line.goalId))) {
          throw new ContributionGoalUnavailableError();
        }
        const parsed = lines.map((line) => ({
          amount: Money.fromDecimal(line.amount, locked.amount.currency),
          goalId: line.goalId,
        }));
        const distribution =
          current ??
          ContributionDistribution.create({
            at,
            authorId: command.actorId,
            lines: parsed,
            ownerId: command.actorId,
            source: locked.amount,
            sourceTransactionId: sourceId,
          });
        if (current !== null) {
          current.replace(parsed, locked.amount, command.actorId, at);
        }
        return {
          auditEvent: FinancialAuditEvent.create({
            action: current === null ? 'created' : 'updated',
            actorId: command.actorId,
            id: auditId,
            occurredAt: at,
            ownerId: command.actorId,
            resourceId: sourceId,
            resourceType: 'goal-contribution',
          }),
          distribution,
        };
      },
      serializeContributionResponse,
    );
    return viewOf(source, parseContributionResponse(stored));
  }
}

export class GetContributionUseCase {
  public constructor(
    private readonly contributions: Pick<
      GoalContributionRepository,
      'findSource' | 'findDistribution'
    >,
  ) {}

  public async execute(
    query: Readonly<{ actorId: string; sourceTransactionId: string }>,
  ): Promise<ContributionView> {
    const sourceId = query.sourceTransactionId.trim().toLowerCase();
    const source = await this.contributions.findSource(sourceId, query.actorId);
    if (source === null) throw new ContributionSourceNotFoundError();
    return viewOf(
      source,
      await this.contributions.findDistribution(sourceId, query.actorId),
    );
  }
}

export class ListContributionSourcesUseCase {
  public constructor(
    private readonly contributions: Pick<
      GoalContributionRepository,
      'listSources'
    >,
  ) {}

  public execute(
    actorId: string,
  ): Promise<readonly ContributionSourceSummary[]> {
    return this.contributions.listSources(actorId);
  }
}

function viewOf(
  source: ContributionSourceView,
  distribution: ContributionDistribution | null,
): ContributionView {
  const zero = Money.fromMinorUnits(0n, source.amount.currency);
  const allocated = distribution?.allocated ?? zero;
  const remaining = source.amount.subtract(allocated);
  return {
    allocated,
    lines: distribution?.lines ?? [],
    remaining: remaining.compare(zero) > 0 ? remaining : zero,
    source,
    version: distribution?.version ?? 0,
  };
}

export function serializeContributionResponse(
  distribution: ContributionDistribution,
): string {
  const snapshot = distribution.toSnapshot();
  return JSON.stringify({
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  });
}

export function parseContributionResponse(
  response: string,
): ContributionDistribution {
  const raw = JSON.parse(response) as Omit<
    ContributionDistributionSnapshot,
    'createdAt' | 'updatedAt'
  > & { createdAt: string; updatedAt: string };
  return ContributionDistribution.restore({
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  });
}
