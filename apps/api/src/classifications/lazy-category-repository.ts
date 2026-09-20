import type { CategoryRepository } from '@seshat/application';
import type { Category } from '@seshat/domain';
import { PrismaCategoryRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyCategoryRepository implements CategoryRepository {
  private repository: PrismaCategoryRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insert(category: Category): Promise<void> {
    return this.getRepository().insert(category);
  }

  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Category | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public listForOwner(ownerId: string): Promise<readonly Category[]> {
    return this.getRepository().listForOwner(ownerId);
  }

  public save(category: Category, expectedVersion: number): Promise<boolean> {
    return this.getRepository().save(category, expectedVersion);
  }

  private getRepository(): PrismaCategoryRepository {
    this.repository ??= new PrismaCategoryRepository(this.prisma.get());
    return this.repository;
  }
}
