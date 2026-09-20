import type { UserProfile, UserProfileRepository } from '@seshat/application';
import { PrismaUserProfileRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyUserProfileRepository implements UserProfileRepository {
  private repository: PrismaUserProfileRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findById(id: string): Promise<UserProfile | null> {
    return this.getRepository().findById(id);
  }

  public upsert(profile: UserProfile): Promise<UserProfile> {
    return this.getRepository().upsert(profile);
  }

  private getRepository(): PrismaUserProfileRepository {
    if (this.repository !== undefined) {
      return this.repository;
    }

    this.repository = new PrismaUserProfileRepository(this.prisma.get());
    return this.repository;
  }
}
