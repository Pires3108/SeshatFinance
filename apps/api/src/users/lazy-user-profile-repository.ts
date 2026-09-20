import type { UserProfile, UserProfileRepository } from '@seshat/application';
import {
  createPrismaClient,
  PrismaUserProfileRepository,
} from '@seshat/database';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class LazyUserProfileRepository
  implements UserProfileRepository, OnApplicationShutdown
{
  private repository: PrismaUserProfileRepository | undefined;
  private client: ReturnType<typeof createPrismaClient> | undefined;

  public findById(id: string): Promise<UserProfile | null> {
    return this.getRepository().findById(id);
  }

  public upsert(profile: UserProfile): Promise<UserProfile> {
    return this.getRepository().upsert(profile);
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.client?.$disconnect();
  }

  private getRepository(): PrismaUserProfileRepository {
    if (this.repository !== undefined) {
      return this.repository;
    }

    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString.length === 0) {
      throw new Error('DATABASE_URL is required for profile persistence.');
    }

    this.client = createPrismaClient(connectionString);
    this.repository = new PrismaUserProfileRepository(this.client);
    return this.repository;
  }
}
