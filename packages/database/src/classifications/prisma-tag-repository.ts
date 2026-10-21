import { DuplicateTagError, type TagRepository } from '@seshat/application';
import { Tag } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaTagRepository implements TagRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(tag: Tag): Promise<void> {
    const snapshot = tag.toSnapshot();
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
        throw new DuplicateTagError();
      await client.tag.create({ data: snapshot });
    });
  }

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Tag | null> {
    const persisted = await this.client.tag.findFirst({
      where: { id, ownerId },
    });
    return persisted === null ? null : Tag.restore(persisted);
  }

  public async listForOwner(ownerId: string): Promise<readonly Tag[]> {
    const persisted = await this.client.tag.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 500,
      where: { ownerId },
    });
    return persisted.map((tag) => Tag.restore(tag));
  }

  public async save(tag: Tag, expectedVersion: number): Promise<boolean> {
    const snapshot = tag.toSnapshot();
    const result = await this.client.$transaction(async (client) => {
      await lockOwner(client, snapshot.ownerId);
      const current = await client.tag.findFirst({
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
      )
        throw new DuplicateTagError();
      return client.tag.updateMany({
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
        const tag = await client.tag.findFirst({
          where: { id, ownerId },
          select: { version: true },
        });
        if (tag?.version !== expectedVersion) return 'conflict';
        if (
          (await client.transactionTag.count({
            where: { ownerId, tagId: id },
          })) > 0
        )
          return 'linked';
        const deleted = await client.tag.deleteMany({
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
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}), 28)::text`;
}

async function hasDuplicateName(
  client: QueryClient,
  ownerId: string,
  name: string,
  excludeId: string,
): Promise<boolean> {
  const matches = await client.$queryRaw<readonly { id: string }[]>`
    SELECT id FROM tags
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
