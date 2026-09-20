import type { CategoryRepository } from '@seshat/application';
import { Category } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaCategoryRepository implements CategoryRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async insert(category: Category): Promise<void> {
    const snapshot = category.toSnapshot();
    await this.client.category.create({ data: snapshot });
  }

  public async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Category | null> {
    const persisted = await this.client.category.findFirst({
      where: { id, ownerId },
    });
    return persisted === null ? null : Category.restore(persisted);
  }

  public async listForOwner(ownerId: string): Promise<readonly Category[]> {
    const persisted = await this.client.category.findMany({
      orderBy: [{ parentCategoryId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: 500,
      where: { ownerId },
    });
    return persisted.map((category) => Category.restore(category));
  }

  public async save(
    category: Category,
    expectedVersion: number,
  ): Promise<boolean> {
    const snapshot = category.toSnapshot();
    const result = await this.client.category.updateMany({
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
