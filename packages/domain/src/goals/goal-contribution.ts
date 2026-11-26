import { Money, type MoneySnapshot } from '../money/money.js';

export const MAX_CONTRIBUTION_LINES = 20;

export type ContributionLine = Readonly<{ goalId: string; amount: Money }>;

export type ContributionLineSnapshot = Readonly<{
  goalId: string;
  amount: MoneySnapshot;
}>;

export type ContributionDistributionSnapshot = Readonly<{
  sourceTransactionId: string;
  ownerId: string;
  /** Who last confirmed the distribution. */
  authorId: string;
  lines: readonly ContributionLineSnapshot[];
  createdAt: Date;
  updatedAt: Date;
  version: number;
}>;

export class InvalidContributionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidContributionError';
  }
}

/** The lines add up to more than the eligible source amount (INV-025). */
export class ContributionExceedsSourceError extends Error {
  public constructor() {
    super('Contributions cannot exceed the eligible source amount.');
    this.name = 'ContributionExceedsSourceError';
  }
}

/**
 * How the holder splits one eligible entry (an income or the incoming side
 * of a transfer) between goals (US-050, RN-070, ADR-043). The entry keeps
 * its full value in the balance; the distribution only labels parts of it
 * (INV-026). Replacing the lines corrects the distribution; an empty list
 * removes it while keeping the version history.
 */
export class ContributionDistribution {
  private constructor(private state: ContributionDistributionSnapshot) {}

  public static create(
    input: Readonly<{
      sourceTransactionId: string;
      ownerId: string;
      authorId: string;
      source: Money;
      lines: readonly ContributionLine[];
      at: Date;
    }>,
  ): ContributionDistribution {
    const at = validDate(input.at);
    return new ContributionDistribution({
      authorId: required(input.authorId, 'authorId'),
      createdAt: at,
      lines: normalizeLines(input.lines, input.source),
      ownerId: required(input.ownerId, 'ownerId'),
      sourceTransactionId: required(
        input.sourceTransactionId,
        'sourceTransactionId',
      ).toLowerCase(),
      updatedAt: at,
      version: 1,
    });
  }

  public static restore(
    snapshot: ContributionDistributionSnapshot,
  ): ContributionDistribution {
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) {
      throw new InvalidContributionError(
        'Contribution version must be a positive integer.',
      );
    }
    return new ContributionDistribution({
      ...snapshot,
      createdAt: validDate(snapshot.createdAt),
      lines: snapshot.lines.map((line) => ({
        amount: Money.restore(line.amount).toSnapshot(),
        goalId: required(line.goalId, 'goalId').toLowerCase(),
      })),
      updatedAt: validDate(snapshot.updatedAt),
    });
  }

  public get sourceTransactionId(): string {
    return this.state.sourceTransactionId;
  }

  public get ownerId(): string {
    return this.state.ownerId;
  }

  public get version(): number {
    return this.state.version;
  }

  public get lines(): readonly ContributionLine[] {
    return this.state.lines.map((line) => ({
      amount: Money.restore(line.amount),
      goalId: line.goalId,
    }));
  }

  /** Sum of the lines, or null when there are none. */
  public get allocated(): Money | null {
    const lines = this.lines;
    const [first, ...rest] = lines;
    if (first === undefined) return null;
    return rest.reduce((sum, line) => sum.add(line.amount), first.amount);
  }

  public replace(
    lines: readonly ContributionLine[],
    source: Money,
    authorId: string,
    at: Date,
  ): void {
    const updatedAt = validDate(at);
    if (updatedAt.getTime() < this.state.updatedAt.getTime()) {
      throw new InvalidContributionError(
        'A contribution change cannot precede the last one.',
      );
    }
    this.state = {
      ...this.state,
      authorId: required(authorId, 'authorId'),
      lines: normalizeLines(lines, source),
      updatedAt,
      version: this.state.version + 1,
    };
  }

  public toSnapshot(): ContributionDistributionSnapshot {
    return {
      ...this.state,
      lines: this.state.lines.map((line) => ({
        amount: { ...line.amount },
        goalId: line.goalId,
      })),
    };
  }
}

function normalizeLines(
  lines: readonly ContributionLine[],
  source: Money,
): readonly ContributionLineSnapshot[] {
  if (lines.length > MAX_CONTRIBUTION_LINES) {
    throw new InvalidContributionError(
      'A contribution accepts at most 20 goals.',
    );
  }
  const zero = Money.fromMinorUnits(0n, source.currency);
  if (source.compare(zero) <= 0) {
    throw new InvalidContributionError('The source must be positive.');
  }
  const seen = new Set<string>();
  let total = zero;
  const normalized = lines.map((line) => {
    const goalId = required(line.goalId, 'goalId').toLowerCase();
    if (seen.has(goalId)) {
      throw new InvalidContributionError('A goal appears once per source.');
    }
    seen.add(goalId);
    if (!line.amount.currency.equals(source.currency)) {
      throw new InvalidContributionError(
        'A contribution uses the source currency.',
      );
    }
    if (line.amount.compare(zero) <= 0) {
      throw new InvalidContributionError('A contribution must be positive.');
    }
    total = total.add(line.amount);
    return { amount: line.amount.toSnapshot(), goalId };
  });
  if (total.compare(source) > 0) throw new ContributionExceedsSourceError();
  return normalized;
}

function required(value: string, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    throw new InvalidContributionError(`Contribution ${field} is required.`);
  }
  return trimmed;
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidContributionError(
      'Contribution instants must be valid dates.',
    );
  }
  return new Date(value.getTime());
}
