import type { CostCenterRepository } from '@seshat/application';
import { CostCenter } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaCostCenterRepository implements CostCenterRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(costCenter: CostCenter): Promise<void> {
    await this.client.costCenter.create({ data: costCenter.toSnapshot() });
  }

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<CostCenter | null> {
    const persisted = await this.client.costCenter.findFirst({
      where: { id, ownerId },
    });
    return persisted === null ? null : CostCenter.restore(persisted);
  }

  public async listForOwner(ownerId: string): Promise<readonly CostCenter[]> {
    const persisted = await this.client.costCenter.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 500,
      where: { ownerId },
    });
    return persisted.map((costCenter) => CostCenter.restore(costCenter));
  }

  public async save(
    costCenter: CostCenter,
    expectedVersion: number,
  ): Promise<boolean> {
    const snapshot = costCenter.toSnapshot();
    const result = await this.client.costCenter.updateMany({
      data: {
        name: snapshot.name,
        updatedAt: snapshot.updatedAt,
        version: snapshot.version,
      },
      where: {
        id: snapshot.id,
        ownerId: snapshot.ownerId,
        version: expectedVersion,
      },
    });
    return result.count === 1;
  }
}
