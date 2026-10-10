import type { OpaqueSessionRepository } from '@seshat/application';
import { PrismaOpaqueSessionRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyOpaqueSessionRepository implements OpaqueSessionRepository {
  public constructor(private readonly prisma: LazyPrismaClient) {}

  private get repository(): PrismaOpaqueSessionRepository {
    return new PrismaOpaqueSessionRepository(this.prisma.get());
  }

  public ready(): Promise<void> {
    return this.repository.ready();
  }

  public create(
    session: Parameters<OpaqueSessionRepository['create']>[0],
  ): Promise<void> {
    return this.repository.create(session);
  }

  public findByTokenHash(
    tokenHash: string,
  ): ReturnType<OpaqueSessionRepository['findByTokenHash']> {
    return this.repository.findByTokenHash(tokenHash);
  }

  public touchIfActive(id: string, seenAt: Date): Promise<boolean> {
    return this.repository.touchIfActive(id, seenAt);
  }

  public revoke(id: string, revokedAt: Date): Promise<void> {
    return this.repository.revoke(id, revokedAt);
  }

  public revokeOthers(
    userId: string,
    exceptId: string,
    revokedAt: Date,
  ): Promise<void> {
    return this.repository.revokeOthers(userId, exceptId, revokedAt);
  }

  public revokeAll(userId: string, revokedAt: Date): Promise<void> {
    return this.repository.revokeAll(userId, revokedAt);
  }
}
