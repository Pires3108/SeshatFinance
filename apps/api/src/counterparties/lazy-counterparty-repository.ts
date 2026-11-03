import type {
  CounterpartyImpact,
  CounterpartyRepository,
} from '@seshat/application';
import type { Counterparty } from '@seshat/domain';
import { PrismaCounterpartyRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyCounterpartyRepository implements CounterpartyRepository {
  private repository: PrismaCounterpartyRepository | undefined;
  public constructor(private readonly prisma: LazyPrismaClient) {}
  public insert(item: Counterparty): Promise<void> {
    return this.getRepository().insert(item);
  }
  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Counterparty | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }
  public listForOwner(
    ownerId: string,
    status?: 'active' | 'inactive' | 'merged' | 'eliminated',
  ): Promise<readonly Counterparty[]> {
    return this.getRepository().listForOwner(ownerId, status);
  }
  public save(item: Counterparty, expectedVersion: number): Promise<boolean> {
    return this.getRepository().save(item, expectedVersion);
  }
  public merge(
    item: Counterparty,
    expectedVersion: number,
    targetId: string,
  ): Promise<'merged' | 'invalid-target' | 'conflict'> {
    return this.getRepository().merge(item, expectedVersion, targetId);
  }
  public impact(id: string, ownerId: string): Promise<CounterpartyImpact> {
    return this.getRepository().impact(id, ownerId);
  }
  public eliminate(
    item: Counterparty,
    expectedVersion: number,
  ): Promise<'eliminated' | 'linked' | 'held' | 'conflict'> {
    return this.getRepository().eliminate(item, expectedVersion);
  }
  public anonymizeDue(at: Date): Promise<number> {
    return this.getRepository().anonymizeDue(at);
  }
  private getRepository(): PrismaCounterpartyRepository {
    this.repository ??= new PrismaCounterpartyRepository(this.prisma.get());
    return this.repository;
  }
}
