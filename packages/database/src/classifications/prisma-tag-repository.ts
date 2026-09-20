import type { TagRepository } from '@seshat/application';
import { Tag } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaTagRepository implements TagRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(tag: Tag): Promise<void> {
    await this.client.tag.create({ data: tag.toSnapshot() });
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
    const result = await this.client.tag.updateMany({
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
