import type {
  CounterpartyImpact,
  CounterpartyRepository,
} from '@seshat/application';
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
    status?: 'active' | 'inactive' | 'merged' | 'eliminated',
  ): Promise<readonly Counterparty[]> {
    const rows = await this.client.counterparty.findMany({
      where: {
        ownerId,
        status: status ?? { in: ['active', 'inactive', 'merged'] },
      },
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
        eliminatedAt: snapshot.eliminatedAt ?? null,
        anonymizedAt: snapshot.anonymizedAt ?? null,
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
        await tx.$queryRaw`SELECT id FROM counterparties WHERE id = ${targetId}::uuid AND owner_id = ${snapshot.ownerId}::uuid FOR SHARE`;
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

  public async impact(
    id: string,
    ownerId: string,
  ): Promise<CounterpartyImpact> {
    const [transactionCount, mergedSourceCount, row] =
      await this.client.$transaction([
        this.client.$queryRaw<
          readonly { link_count: bigint }[]
        >`SELECT counterparty_financial_link_count(${ownerId}::uuid, ${id}::uuid) AS link_count`,
        this.client.counterparty.count({
          where: { ownerId, mergedIntoId: id },
        }),
        this.client.counterparty.findFirst({
          where: { id, ownerId },
          select: { legalHold: true, status: true },
        }),
      ]);
    return {
      transactionCount: Number(transactionCount[0]?.link_count ?? 0n),
      mergedSourceCount,
      legalHold: row?.legalHold ?? false,
      canEliminate:
        (transactionCount[0]?.link_count ?? 0n) === 0n &&
        mergedSourceCount === 0 &&
        row?.legalHold === false &&
        (row.status === 'active' || row.status === 'inactive'),
    };
  }

  public async eliminate(
    item: Counterparty,
    expectedVersion: number,
  ): Promise<'eliminated' | 'linked' | 'held' | 'conflict'> {
    const snapshot = item.toSnapshot();
    return this.client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM counterparties WHERE id = ${snapshot.id}::uuid AND owner_id = ${snapshot.ownerId}::uuid FOR UPDATE`;
        const row = await tx.counterparty.findFirst({
          where: { id: snapshot.id, ownerId: snapshot.ownerId },
          select: { legalHold: true },
        });
        if (row === null) return 'conflict';
        if (row.legalHold) return 'held';
        const links = await tx.$queryRaw<
          readonly { link_count: bigint }[]
        >`SELECT counterparty_financial_link_count(${snapshot.ownerId}::uuid, ${snapshot.id}::uuid) AS link_count`;
        const sources = await tx.counterparty.count({
          where: { ownerId: snapshot.ownerId, mergedIntoId: snapshot.id },
        });
        if ((links[0]?.link_count ?? 0n) > 0n || sources > 0) return 'linked';
        const result = await tx.counterparty.updateMany({
          where: {
            id: snapshot.id,
            ownerId: snapshot.ownerId,
            version: expectedVersion,
            status: { in: ['active', 'inactive'] },
          },
          data: {
            status: 'eliminated',
            eliminatedAt: snapshot.eliminatedAt ?? null,
            updatedAt: snapshot.updatedAt,
            version: snapshot.version,
          },
        });
        return result.count === 1 ? 'eliminated' : 'conflict';
      },
      { isolationLevel: 'Serializable' },
    );
  }

  public async anonymizeDue(at: Date): Promise<number> {
    const cutoff = new Date(at.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.client.$executeRaw`
      UPDATE counterparties AS target
      SET name = 'Entidade eliminada', email = NULL, phone = NULL,
          document = NULL, notes = NULL, anonymized_at = ${at},
          updated_at = ${at}, version = version + 1
      WHERE target.status = 'eliminated' AND target.eliminated_at <= ${cutoff}
        AND target.anonymized_at IS NULL AND target.legal_hold = false
        AND counterparty_financial_link_count(target.owner_id, target.id) = 0
        AND NOT EXISTS (SELECT 1 FROM counterparties AS source
          WHERE source.owner_id = target.owner_id AND source.merged_into_id = target.id)
    `;
  }
}
