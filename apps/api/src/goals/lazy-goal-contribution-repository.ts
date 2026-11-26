import type {
  ContributionGoalState,
  ContributionSourceSummary,
  ContributionSourceView,
  ContributionWrite,
  GoalContributionRepository,
  IdempotencyRequest,
} from '@seshat/application';
import type {
  ContributionDistribution,
  GoalContributionPosition,
} from '@seshat/domain';
import { PrismaGoalContributionRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyGoalContributionRepository implements GoalContributionRepository {
  private repository: PrismaGoalContributionRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public findDistribution(
    sourceId: string,
    ownerId: string,
  ): Promise<ContributionDistribution | null> {
    return this.getRepository().findDistribution(sourceId, ownerId);
  }

  public findSource(
    sourceId: string,
    ownerId: string,
  ): Promise<ContributionSourceView | null> {
    return this.getRepository().findSource(sourceId, ownerId);
  }

  public listSources(
    ownerId: string,
  ): Promise<readonly ContributionSourceSummary[]> {
    return this.getRepository().listSources(ownerId);
  }

  public listPositionsForGoals(
    ownerId: string,
    goalIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly GoalContributionPosition[]>> {
    return this.getRepository().listPositionsForGoals(ownerId, goalIds);
  }

  public saveAtomically(
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
  ): Promise<string> {
    return this.getRepository().saveAtomically(
      request,
      sourceId,
      expectedVersion,
      goalIds,
      build,
      serialize,
    );
  }

  private getRepository(): PrismaGoalContributionRepository {
    this.repository ??= new PrismaGoalContributionRepository(this.prisma.get());
    return this.repository;
  }
}
