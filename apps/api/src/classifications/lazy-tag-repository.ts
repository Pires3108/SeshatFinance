import type { TagRepository } from '@seshat/application';
import type { Tag } from '@seshat/domain';
import { PrismaTagRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyTagRepository implements TagRepository {
  private repository: PrismaTagRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public insert(tag: Tag): Promise<void> {
    return this.getRepository().insert(tag);
  }

  public findByIdForOwner(id: string, ownerId: string): Promise<Tag | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public listForOwner(ownerId: string): Promise<readonly Tag[]> {
    return this.getRepository().listForOwner(ownerId);
  }

  public save(tag: Tag, expectedVersion: number): Promise<boolean> {
    return this.getRepository().save(tag, expectedVersion);
  }

  private getRepository(): PrismaTagRepository {
    this.repository ??= new PrismaTagRepository(this.prisma.get());
    return this.repository;
  }
}
