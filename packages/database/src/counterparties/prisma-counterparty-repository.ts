import type { CounterpartyRepository } from '@seshat/application';
import { Counterparty } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaCounterpartyRepository implements CounterpartyRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(item: Counterparty): Promise<void> {
    await this.client.counterparty.create({ data: item.toSnapshot() });
  }

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Counterparty | null> {
    const row = await this.client.counterparty.findFirst({
      where: { id, ownerId },
    });
    return row === null ? null : Counterparty.restore(row);
  }

  public async listForOwner(
    ownerId: string,
    status?: 'active' | 'inactive' | 'merged',
  ): Promise<readonly Counterparty[]> {
    const rows = await this.client.counterparty.findMany({
      where: { ownerId, ...(status === undefined ? {} : { status }) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.map((row) => Counterparty.restore(row));
  }

  public async save(
    item: Counterparty,
    expectedVersion: number,
  ): Promise<boolean> {
    const snapshot = item.toSnapshot();
    const result = await this.client.counterparty.updateMany({
      data: {
        name: snapshot.name,
        type: snapshot.type,
        email: snapshot.email,
        phone: snapshot.phone,
        document: snapshot.document,
        notes: snapshot.notes,
        status: snapshot.status,
        mergedIntoId: snapshot.mergedIntoId,
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

  public async merge(
    item: Counterparty,
    expectedVersion: number,
    targetId: string,
  ): Promise<'merged' | 'invalid-target' | 'conflict'> {
    const snapshot = item.toSnapshot();
    return this.client.$transaction(
      async (tx) => {
        const target = await tx.counterparty.findFirst({
          where: { id: targetId, ownerId: snapshot.ownerId, status: 'active' },
        });
        if (target === null || target.id === snapshot.id)
          return 'invalid-target';
        const result = await tx.counterparty.updateMany({
          data: {
            status: 'merged',
            mergedIntoId: targetId,
            updatedAt: snapshot.updatedAt,
            version: snapshot.version,
          },
          where: {
            id: snapshot.id,
            ownerId: snapshot.ownerId,
            version: expectedVersion,
            status: { in: ['active', 'inactive'] },
          },
        });
        return result.count === 1 ? 'merged' : 'conflict';
      },
      { isolationLevel: 'Serializable' },
    );
  }
}
