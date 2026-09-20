import { createPrismaClient } from '@seshat/database';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class LazyPrismaClient implements OnApplicationShutdown {
  private client: ReturnType<typeof createPrismaClient> | undefined;

  public get(): ReturnType<typeof createPrismaClient> {
    if (this.client !== undefined) return this.client;
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString.length === 0) {
      throw new Error('DATABASE_URL is required for persistence.');
    }
    this.client = createPrismaClient(connectionString);
    return this.client;
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.client?.$disconnect();
  }
}
