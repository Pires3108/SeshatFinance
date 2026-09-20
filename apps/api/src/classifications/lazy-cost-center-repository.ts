import type { CostCenterRepository } from '@seshat/application';
import type { CostCenter } from '@seshat/domain';
import { PrismaCostCenterRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyCostCenterRepository implements CostCenterRepository {
  private repository: PrismaCostCenterRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insert(costCenter: CostCenter): Promise<void> {
    return this.getRepository().insert(costCenter);
  }

  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<CostCenter | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public listForOwner(ownerId: string): Promise<readonly CostCenter[]> {
    return this.getRepository().listForOwner(ownerId);
  }

  public save(
    costCenter: CostCenter,
    expectedVersion: number,
  ): Promise<boolean> {
    return this.getRepository().save(costCenter, expectedVersion);
  }

  private getRepository(): PrismaCostCenterRepository {
    this.repository ??= new PrismaCostCenterRepository(this.prisma.get());
    return this.repository;
  }
}
