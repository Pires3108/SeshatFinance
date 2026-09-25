import { Inject, Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

const readinessTimeoutMs = 2_000;

@Injectable()
export class DatabaseReadiness {
  public constructor(
    @Inject(LazyPrismaClient) private readonly prisma: LazyPrismaClient,
  ) {}

  public async isReady(): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const query = this.prisma.get().$queryRaw`SELECT 1`;
      return await Promise.race([
        query.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => {
            resolve(false);
          }, readinessTimeoutMs);
        }),
      ]);
    } catch {
      return false;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
