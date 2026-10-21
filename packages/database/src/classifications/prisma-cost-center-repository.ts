import {
  DuplicateCostCenterError,
  type CostCenterRepository,
} from '@seshat/application';
import { CostCenter } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaCostCenterRepository implements CostCenterRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(costCenter: CostCenter): Promise<void> {
    const snapshot = costCenter.toSnapshot();
    await this.client.$transaction(async (client) => {
      await lockOwner(client, snapshot.ownerId);
      if (
        await hasDuplicateName(
          client,
          snapshot.ownerId,
          snapshot.name,
          snapshot.id,
        )
      )
        throw new DuplicateCostCenterError();
      await client.costCenter.create({ data: snapshot });
    });
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
    const result = await this.client.$transaction(async (client) => {
      await lockOwner(client, snapshot.ownerId);
      const current = await client.costCenter.findFirst({
        select: { name: true },
        where: {
          id: snapshot.id,
          ownerId: snapshot.ownerId,
          version: expectedVersion,
        },
      });
      if (
        current !== null &&
        current.name !== snapshot.name &&
        (await hasDuplicateName(
          client,
          snapshot.ownerId,
          snapshot.name,
          snapshot.id,
        ))
      ) {
        throw new DuplicateCostCenterError();
      }
      return client.costCenter.updateMany({
        data: {
          archivedAt: snapshot.archivedAt ?? null,
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
    });
    return result.count === 1;
  }

  public async deleteUnlinked(
    id: string,
    ownerId: string,
    expectedVersion: number,
  ): Promise<'deleted' | 'linked' | 'conflict'> {
    try {
      return await this.client.$transaction(async (client) => {
        await lockOwner(client, ownerId);
        const costCenter = await client.costCenter.findFirst({
          where: { id, ownerId },
          select: { version: true },
        });
        if (costCenter?.version !== expectedVersion) return 'conflict';
        if (
          (await client.transaction.count({
            where: { ownerId, costCenterId: id },
          })) > 0
        )
          return 'linked';
        const deleted = await client.costCenter.deleteMany({
          where: { id, ownerId, version: expectedVersion },
        });
        return deleted.count === 1 ? 'deleted' : 'conflict';
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) return 'linked';
      throw error;
    }
  }
}

type QueryClient = Pick<PrismaClient, '$queryRaw'>;

async function lockOwner(client: QueryClient, ownerId: string): Promise<void> {
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}), 29)::text`;
}

async function hasDuplicateName(
  client: QueryClient,
  ownerId: string,
  name: string,
  excludeId: string,
): Promise<boolean> {
  const matches = await client.$queryRaw<readonly { id: string }[]>`
    SELECT id FROM cost_centers
    WHERE owner_id = ${ownerId}::uuid
      AND lower(trim(name)) = lower(trim(${name}))
      AND id <> ${excludeId}::uuid
    LIMIT 1`;
  return matches.length > 0;
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2003'
  );
}
